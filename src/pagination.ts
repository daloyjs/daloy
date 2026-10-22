/**
 * Cursor pagination helpers for DaloyJS.
 *
 * Contract-first list endpoints need three things the framework did not yet
 * ship: an **opaque cursor** the client can echo back without depending on its
 * internals, an **RFC 8288 `Link` header** advertising the `next` / `prev` /
 * `first` pages, and **OpenAPI parameter wiring** so the `cursor` / `limit`
 * query parameters appear in the generated spec and typed client. This module
 * provides all three with zero runtime dependencies:
 *
 * - {@link encodeCursor} / {@link decodeCursor} — base64url-encode an arbitrary
 *   JSON-serializable payload (typically the sort key of the last row) into an
 *   opaque, URL-safe token, and decode it back with prototype-pollution-safe
 *   parsing and a hard size cap.
 * - {@link createCursorCodec} — the same codec with an HMAC-SHA256 signature
 *   (and optional expiry) appended, so a client cannot edit the decoded
 *   payload (`{ tenantId }`, `{ offset }`) and have the server trust it.
 * - {@link buildLinkHeader} / {@link buildPageLinks} — assemble a Web-standard
 *   `Link` header, with CRLF / angle-bracket header-injection guards baked in.
 * - {@link paginationQuery} — a Standard Schema validator for the `cursor` +
 *   `limit` query parameters that both validates runtime page-size bounds
 *   **and** advertises itself to the OpenAPI generator via a
 *   `toJSONSchema()` method, so `request: { query: paginationQuery() }` wires
 *   the parameters into the contract with no extra code.
 *
 * Everything here is built on Web-standard `URL` / `Request` and `btoa` /
 * `atob`, so it runs unchanged on Node, Bun, Deno, Cloudflare Workers, and
 * Vercel.
 *
 * @module
 * @since 0.37.0
 */

import { BadRequestError } from "./errors.js";
import { safeJsonParseLimited, timingSafeEqual } from "./security.js";
import { isForbiddenObjectKey } from "./security.js";
import type { StandardSchemaV1 } from "./schema.js";

/**
 * Hard cap on the length of an encoded cursor string accepted by
 * {@link decodeCursor}. Bounds the work an attacker can force by sending a
 * giant `cursor` query parameter. 4 KiB is far larger than any legitimate
 * sort-key payload.
 */
export const MAX_CURSOR_LENGTH = 4096;

// ---------- Opaque cursor codec ----------

/**
 * Encode an arbitrary JSON-serializable value into an opaque, URL-safe cursor
 * token (base64url, no padding).
 *
 * The token is **opaque, not secret**: it is encoded, not encrypted or signed.
 * Never trust a decoded cursor for authorization — always re-scope the
 * underlying query by the authenticated principal on the server. Put only the
 * data you need to resume a scan (e.g. `{ id, createdAt }`) inside it.
 *
 * @param payload - Any JSON-serializable value (object, array, string, …).
 * @returns A base64url cursor string safe to place in a URL or `Link` header.
 * @throws {TypeError} If `payload` cannot be JSON-serialized (e.g. a `BigInt`
 *   or a circular structure).
 * @since 0.37.0
 */
export function encodeCursor(payload: unknown): string {
  const json = JSON.stringify(payload);
  if (json === undefined) {
    throw new TypeError("encodeCursor(): payload is not JSON-serializable.");
  }
  return base64UrlEncode(json);
}

/**
 * Decode an opaque cursor produced by {@link encodeCursor} back into its
 * original value.
 *
 * Parsing is hardened: the input length is capped at {@link MAX_CURSOR_LENGTH},
 * decoding rejects malformed base64url, and any `__proto__` / `constructor` /
 * `prototype` keys in the decoded object graph are stripped (prototype-
 * pollution defense, mirroring the core body parsers).
 *
 * @typeParam T - The expected shape of the decoded payload (caller-asserted).
 * @param cursor - The opaque cursor string from the request.
 * @returns The decoded payload.
 * @throws {BadRequestError} If the cursor is missing, over-long, or malformed —
 *   a `400` so a tampered cursor surfaces as a client error, not a `500`.
 * @since 0.37.0
 */
export function decodeCursor<T = unknown>(cursor: string): T {
  if (typeof cursor !== "string" || cursor.length === 0) {
    throw new BadRequestError("Invalid pagination cursor.");
  }
  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw new BadRequestError("Pagination cursor is too long.");
  }
  let json: string;
  try {
    json = base64UrlDecode(cursor);
  } catch {
    throw new BadRequestError("Malformed pagination cursor.");
  }
  let parsed: unknown;
  try {
    // Use limited parse for structural safety (wide/deep cursors).
    // Cursors are length-capped at 4k so even default limits are very generous here.
    parsed = safeJsonParseLimited(json, 1000, 20);
  } catch {
    throw new BadRequestError("Malformed pagination cursor.");
  }
  return stripForbiddenKeys(parsed) as T;
}

// ---------- Signed cursor codec ----------

/** Options for {@link createCursorCodec}. */
export interface CursorCodecOptions {
  /**
   * HMAC-SHA256 key(s). A string or a list for rotation: the **first** entry
   * signs new cursors, every entry may verify an incoming one, so a rotated
   * key keeps outstanding cursors valid until they expire. Each must be at
   * least 16 characters. Load it from an env var or secret manager; a
   * guessable key lets a client forge any payload.
   */
  secret: string | readonly string[];
  /**
   * Seconds a cursor stays valid after `encode()`. `undefined` (default)
   * means no expiry. A bound keeps a leaked cursor from being replayed
   * indefinitely and lets a key rotate out once every cursor signed with it
   * has aged past this. Must be a positive integer when set.
   */
  ttlSeconds?: number;
  /**
   * Clock in milliseconds since the Unix epoch, for `ttlSeconds`. Defaults
   * to `Date.now`; override in tests.
   */
  now?: () => number;
}

/**
 * A cursor codec whose tokens carry an HMAC-SHA256 signature. Returned by
 * {@link createCursorCodec}.
 */
export interface CursorCodec {
  /**
   * Encode `payload` into a signed, opaque, URL-safe cursor.
   *
   * @throws {TypeError} If `payload` is not JSON-serializable.
   */
  encode(payload: unknown): Promise<string>;
  /**
   * Verify a cursor's signature (and expiry, when `ttlSeconds` is set) and
   * return its payload. Every failure — a tampered payload, a forged or
   * truncated signature, an expired or malformed token — is one
   * `BadRequestError("Invalid pagination cursor.")`, so the response never
   * tells a client which check it failed.
   *
   * @throws {BadRequestError} On any verification failure.
   */
  decode<T = unknown>(cursor: string): Promise<T>;
}

const CURSOR_ENC = new TextEncoder();
/** Base64url of a 32-byte SHA-256 MAC is always 43 characters. */
const CURSOR_SIG_LENGTH = 43;

function cursorSubtle(): SubtleCrypto {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      "createCursorCodec(): Web Crypto (crypto.subtle) is required. Provide a polyfill in environments without it."
    );
  }
  return c.subtle;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Create a cursor codec that signs every token with HMAC-SHA256, so the
 * decoded payload can be trusted as the server's own and not the client's.
 *
 * {@link encodeCursor} / {@link decodeCursor} produce **opaque but unsigned**
 * tokens: anyone can base64url-decode one, change `{ offset: 20 }` to
 * `{ offset: 0 }` or `{ tenantId: "a" }` to `{ tenantId: "b" }`, and re-encode
 * it. That is fine as long as the handler re-scopes the query by the
 * authenticated principal and treats the cursor as a hint. When the cursor
 * carries anything the query *relies* on — a tenant, a filter, a stable sort
 * boundary that must not be skipped — use this codec instead.
 *
 * Token format: `<base64url(json)>.<base64url(hmac)>`, with an optional
 * expiry folded into the signed bytes when `ttlSeconds` is set. Decoding
 * applies the same {@link MAX_CURSOR_LENGTH} cap, strict base64url, and
 * prototype-pollution stripping as {@link decodeCursor}, verifies the MAC in
 * constant time **before** parsing the JSON, and accepts every configured
 * secret so keys can rotate without invalidating cursors in flight.
 *
 * @example
 * ```ts
 * const cursors = createCursorCodec({
 *   secret: process.env.CURSOR_SECRET!,
 *   ttlSeconds: 3600,
 * });
 *
 * // In the handler:
 * const after = query.cursor ? await cursors.decode<{ id: string }>(query.cursor) : undefined;
 * const rows = await db.listAfter(after?.id, query.limit + 1);
 * const next = rows.length > query.limit
 *   ? await cursors.encode({ id: rows[query.limit - 1]!.id })
 *   : undefined;
 * ```
 *
 * @param options - Secret(s), optional TTL, and clock.
 * @returns A {@link CursorCodec}.
 * @throws {Error} At construction when a secret is missing or shorter than 16
 *   characters, or `ttlSeconds` is not a positive integer.
 * @since 1.16.0
 */
export function createCursorCodec(options: CursorCodecOptions): CursorCodec {
  const secrets =
    typeof options.secret === "string" ? [options.secret] : Array.from(options.secret ?? []);
  if (secrets.length === 0) {
    throw new Error("createCursorCodec(): at least one secret is required.");
  }
  for (const s of secrets) {
    if (typeof s !== "string" || s.length < 16) {
      throw new Error(
        "createCursorCodec(): each secret must be a string of at least 16 characters — it is the " +
          "HMAC key that signs every cursor, so a short or guessable value lets a client forge the " +
          "payload. Generate one with `openssl rand -base64 32` and load it from an env var."
      );
    }
  }
  const ttl = options.ttlSeconds;
  if (ttl !== undefined && !(Number.isSafeInteger(ttl) && ttl > 0)) {
    throw new Error("createCursorCodec(): ttlSeconds must be a positive integer when set.");
  }
  const now = options.now ?? Date.now;

  const keys: Array<Promise<CryptoKey> | null> = secrets.map(() => null);
  const keyFor = (i: number): Promise<CryptoKey> => {
    let k = keys[i];
    if (!k) {
      k = cursorSubtle().importKey(
        "raw",
        CURSOR_ENC.encode(secrets[i]!),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      keys[i] = k;
    }
    return k;
  };
  const mac = async (i: number, data: string): Promise<string> => {
    const sig = await cursorSubtle().sign("HMAC", await keyFor(i), CURSOR_ENC.encode(data));
    return bytesToBase64Url(new Uint8Array(sig));
  };
  const fail = (): never => {
    throw new BadRequestError("Invalid pagination cursor.");
  };

  return {
    async encode(payload) {
      const json = JSON.stringify(payload);
      if (json === undefined) {
        throw new TypeError("createCursorCodec(): payload is not JSON-serializable.");
      }
      // The expiry is part of the signed string, so it cannot be extended.
      const body =
        ttl === undefined
          ? base64UrlEncode(json)
          : `${base64UrlEncode(json)}.${Math.floor(now() / 1000) + ttl}`;
      return `${body}.${await mac(0, body)}`;
    },
    async decode<T = unknown>(cursor: string): Promise<T> {
      if (typeof cursor !== "string" || cursor.length === 0) return fail();
      if (cursor.length > MAX_CURSOR_LENGTH) return fail();
      const dot = cursor.lastIndexOf(".");
      if (dot <= 0 || cursor.length - dot - 1 !== CURSOR_SIG_LENGTH) return fail();
      const body = cursor.slice(0, dot);
      const sig = cursor.slice(dot + 1);
      if (!/^[A-Za-z0-9_-]+$/.test(sig)) return fail();
      // Verify before parsing: an unauthenticated token never reaches JSON.parse.
      let valid = false;
      for (let i = 0; i < secrets.length; i++) {
        if (timingSafeEqual(await mac(i, body), sig)) valid = true;
      }
      if (!valid) return fail();
      let payloadB64 = body;
      if (ttl !== undefined) {
        const expDot = body.lastIndexOf(".");
        if (expDot <= 0) return fail();
        const exp = Number(body.slice(expDot + 1));
        if (!Number.isSafeInteger(exp) || exp < Math.floor(now() / 1000)) return fail();
        payloadB64 = body.slice(0, expDot);
      } else if (body.includes(".")) {
        return fail();
      }
      let parsed: unknown;
      try {
        parsed = safeJsonParseLimited(base64UrlDecode(payloadB64), 1000, 20);
      } catch {
        return fail();
      }
      return stripForbiddenKeys(parsed) as T;
    },
  };
}

// ---------- RFC 8288 Link header ----------

/** A single web link for an RFC 8288 `Link` header. */
export interface PaginationLink {
  /** Target URI-Reference (the `<...>` portion). */
  url: string;
  /** Relation type, e.g. `"next"`, `"prev"`, `"first"`, `"last"`. */
  rel: string;
  /** Optional human-readable `title` parameter. */
  title?: string;
}

// Reject control characters and the structural delimiters that would let a
// crafted URL or title break out of the header (CRLF injection, `<`/`>`).
const LINK_URL_FORBIDDEN = /[\u0000-\u001f\u007f<>]/;
const LINK_TOKEN_FORBIDDEN = /[\u0000-\u001f\u007f"\\]/;

/**
 * Serialize a list of links into a single RFC 8288 `Link` header value.
 *
 * Each entry renders as `<url>; rel="rel"` (plus `; title="…"` when present).
 * URLs containing control characters, `<`, or `>` and rel/title values
 * containing control characters, `"`, or `\` are rejected — a structural
 * defense against `Link`-header / response-splitting injection.
 *
 * @param links - The links to emit. An empty array yields an empty string.
 * @returns The comma-joined `Link` header value.
 * @throws {Error} If any URL or token contains forbidden characters.
 * @since 0.37.0
 */
export function buildLinkHeader(links: readonly PaginationLink[]): string {
  const parts: string[] = [];
  for (const link of links) {
    if (LINK_URL_FORBIDDEN.test(link.url)) {
      throw new Error("buildLinkHeader(): link URL contains forbidden characters.");
    }
    if (LINK_TOKEN_FORBIDDEN.test(link.rel)) {
      throw new Error("buildLinkHeader(): link rel contains forbidden characters.");
    }
    let part = `<${link.url}>; rel="${link.rel}"`;
    if (link.title !== undefined) {
      if (LINK_TOKEN_FORBIDDEN.test(link.title)) {
        throw new Error("buildLinkHeader(): link title contains forbidden characters.");
      }
      part += `; title="${link.title}"`;
    }
    parts.push(part);
  }
  return parts.join(", ");
}

/** Options for {@link buildPageLinks}. */
export interface PageLinkOptions {
  /** The current request URL (string or `URL`); other query params are kept. */
  url: string | URL;
  /** Query-parameter name carrying the cursor. Default: `"cursor"`. */
  cursorParam?: string;
  /** Opaque cursor for the next page, or `null`/`undefined` to omit `next`. */
  next?: string | null;
  /** Opaque cursor for the previous page, or `null`/`undefined` to omit `prev`. */
  prev?: string | null;
  /**
   * Emit a `rel="first"` link (the current URL with the cursor param removed).
   * Default: `false`.
   */
  first?: boolean;
  /** Extra links appended verbatim (e.g. a `rel="last"`). */
  extraLinks?: readonly PaginationLink[];
}

/** Result of {@link buildPageLinks}. */
export interface PageLinks {
  /** The structured links, ready for {@link buildLinkHeader} or a JSON body. */
  links: PaginationLink[];
  /** The serialized RFC 8288 `Link` header value (empty when no links). */
  linkHeader: string;
  /** Convenience map of the computed page URLs. */
  urls: { self: string; next?: string; prev?: string; first?: string };
}

/**
 * Build the `next` / `prev` / `first` page URLs for a list response by cloning
 * the current request URL and swapping its cursor query parameter, then
 * serialize them into an RFC 8288 `Link` header.
 *
 * All other query parameters (filters, `limit`, …) are preserved, so the
 * generated links are drop-in "give me the same query, next page" URLs.
 *
 * @example
 * ```ts
 * const { linkHeader } = buildPageLinks({
 *   url: ctx.request.url,
 *   next: nextCursor,        // from encodeCursor(...)
 *   prev: prevCursor,
 *   first: true,
 * });
 * set.headers.set("Link", linkHeader);
 * ```
 *
 * @param opts - Current URL plus the cursors to advertise.
 * @returns The structured links, the `Link` header string, and the page URLs.
 * @since 0.37.0
 */
export function buildPageLinks(opts: PageLinkOptions): PageLinks {
  const cursorParam = opts.cursorParam ?? "cursor";
  const base = new URL(typeof opts.url === "string" ? opts.url : opts.url.href);

  const self = base.href;
  const links: PaginationLink[] = [];
  const urls: PageLinks["urls"] = { self };

  if (opts.next !== undefined && opts.next !== null) {
    const u = new URL(base.href);
    u.searchParams.set(cursorParam, opts.next);
    urls.next = u.href;
    links.push({ url: u.href, rel: "next" });
  }
  if (opts.prev !== undefined && opts.prev !== null) {
    const u = new URL(base.href);
    u.searchParams.set(cursorParam, opts.prev);
    urls.prev = u.href;
    links.push({ url: u.href, rel: "prev" });
  }
  if (opts.first === true) {
    const u = new URL(base.href);
    u.searchParams.delete(cursorParam);
    urls.first = u.href;
    links.push({ url: u.href, rel: "first" });
  }
  if (opts.extraLinks) links.push(...opts.extraLinks);

  return { links, linkHeader: buildLinkHeader(links), urls };
}

// ---------- OpenAPI-wired query schema ----------

/** Options for {@link paginationQuery}. */
export interface PaginationQueryOptions {
  /** Query-parameter name for the cursor. Default: `"cursor"`. */
  cursorParam?: string;
  /** Query-parameter name for the page size. Default: `"limit"`. */
  limitParam?: string;
  /** Default page size applied when `limit` is omitted. Default: `min(20, maxLimit)`. */
  defaultLimit?: number;
  /** Minimum accepted page size. Default: `1`. */
  minLimit?: number;
  /** Maximum accepted page size. Over-large requests are rejected. Default: `100`. */
  maxLimit?: number;
}

/** Validated output of {@link paginationQuery}. */
export interface PaginationParams {
  /** The resolved page size after validation against `[minLimit, maxLimit]`. */
  limit: number;
  /** The opaque cursor, if the client supplied one. */
  cursor?: string;
}

/**
 * A Standard Schema for cursor-pagination query parameters that also carries a
 * `toJSONSchema()` method so the OpenAPI generator wires the `cursor` and
 * `limit` parameters into the contract automatically.
 */
export interface PaginationQuerySchema extends StandardSchemaV1<
  Record<string, unknown>,
  PaginationParams
> {
  /** Used by the OpenAPI generator to emit the query parameters. */
  toJSONSchema(): Record<string, unknown>;
}

/**
 * Build a Standard Schema validator for cursor-pagination query parameters.
 *
 * Use it as a route's `request.query`. At runtime it parses and validates
 * `limit` (coerced from its string query value to an integer, rejected when
 * outside `[minLimit, maxLimit]`, and defaulting to `defaultLimit` when absent)
 * and passes `cursor` through as an optional opaque string. Because it also
 * exposes `toJSONSchema()`, the same call wires both parameters into the
 * generated OpenAPI document and typed client — no duplicate parameter
 * declarations.
 *
 * @example
 * ```ts
 * app.route({
 *   method: "GET",
 *   path: "/books",
 *   operationId: "listBooks",
 *   request: { query: paginationQuery({ defaultLimit: 25, maxLimit: 100 }) },
 *   responses: { 200: { description: "ok", body: pageSchema } },
 *   handler: async ({ query }) => {
 *     const { limit, cursor } = query; // fully typed + validated
 *     // ...
 *   },
 * });
 * ```
 *
 * @param opts - Parameter names and page-size bounds.
 * @returns A Standard Schema usable as `request.query`.
 * @throws {Error} If the configured bounds are not positive integers or are
 *   inconsistent (`minLimit > maxLimit`, `defaultLimit` out of range).
 * @since 0.37.0
 */
export function paginationQuery(opts: PaginationQueryOptions = {}): PaginationQuerySchema {
  const cursorParam = opts.cursorParam ?? "cursor";
  const limitParam = opts.limitParam ?? "limit";
  const minLimit = opts.minLimit ?? 1;
  const maxLimit = opts.maxLimit ?? 100;
  const defaultLimit = opts.defaultLimit ?? Math.min(20, maxLimit);

  for (const [label, n] of [
    ["minLimit", minLimit],
    ["maxLimit", maxLimit],
    ["defaultLimit", defaultLimit],
  ] as const) {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`paginationQuery(): ${label} must be a positive integer.`);
    }
  }
  if (minLimit > maxLimit) {
    throw new Error("paginationQuery(): minLimit must not exceed maxLimit.");
  }
  if (defaultLimit < minLimit || defaultLimit > maxLimit) {
    throw new Error("paginationQuery(): defaultLimit must be within [minLimit, maxLimit].");
  }

  return {
    "~standard": {
      version: 1,
      vendor: "daloyjs",
      validate(value): StandardSchemaV1.Result<PaginationParams> {
        if (value === null || typeof value !== "object") {
          return { issues: [{ message: "Expected a query object" }] };
        }
        const input = value as Record<string, unknown>;
        const out: PaginationParams = { limit: defaultLimit };

        const rawLimit = input[limitParam];
        if (rawLimit !== undefined && rawLimit !== "") {
          const limitStr = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit;
          const n = Number(limitStr);
          if (!Number.isInteger(n)) {
            return {
              issues: [{ message: `${limitParam} must be an integer`, path: [limitParam] }],
            };
          }
          if (n < minLimit || n > maxLimit) {
            return {
              issues: [
                {
                  message: `${limitParam} must be between ${minLimit} and ${maxLimit}`,
                  path: [limitParam],
                },
              ],
            };
          }
          out.limit = n;
        }

        const rawCursor = input[cursorParam];
        if (rawCursor !== undefined && rawCursor !== "") {
          const cursorStr = Array.isArray(rawCursor) ? rawCursor[0] : rawCursor;
          if (typeof cursorStr !== "string") {
            return {
              issues: [{ message: `${cursorParam} must be a string`, path: [cursorParam] }],
            };
          }
          if (cursorStr.length > MAX_CURSOR_LENGTH) {
            return {
              issues: [{ message: `${cursorParam} is too long`, path: [cursorParam] }],
            };
          }
          out.cursor = cursorStr;
        }

        return { value: out };
      },
    },
    toJSONSchema() {
      return {
        type: "object",
        properties: {
          [limitParam]: {
            type: "integer",
            minimum: minLimit,
            maximum: maxLimit,
            default: defaultLimit,
            description: "Maximum number of items to return.",
          },
          [cursorParam]: {
            type: "string",
            maxLength: MAX_CURSOR_LENGTH,
            description: "Opaque cursor identifying the page to return.",
          },
        },
        required: [],
      };
    },
  };
}

// ---------- Internal helpers ----------

/** Encode a UTF-8 string as base64url without padding. */
function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a base64url (optionally padded) string back to a UTF-8 string. */
function base64UrlDecode(input: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) {
    throw new Error("invalid base64url");
  }
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Recursively remove prototype-pollution sink keys (`__proto__`,
 * `constructor`, `prototype`) from a decoded cursor payload.
 */
function stripForbiddenKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => stripForbiddenKeys(v));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isForbiddenObjectKey(k)) continue;
      out[k] = stripForbiddenKeys(v);
    }
    return out;
  }
  return value;
}
