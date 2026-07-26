/**
 * Server-side response caching for DaloyJS.
 *
 * The {@link responseCache} middleware stores rendered response bodies in a
 * pluggable backend and replays them for subsequent matching requests, so a
 * hot read endpoint can skip the handler (and its database / upstream calls)
 * entirely while a cached representation is fresh. It complements — and does
 * not overlap with — the two caching-adjacent helpers DaloyJS already ships:
 *
 * - `etag()` answers conditional `GET`s with `304 Not Modified` but still runs
 *   the handler to produce the body it hashes.
 * - `compression()` shrinks the bytes on the wire but caches nothing.
 *
 * `responseCache()` is the missing third piece: it caches the **body** so the
 * handler is not invoked at all on a fresh hit.
 *
 * Highlights:
 *
 * - **`Cache-Control` orchestration.** Freshness is derived from the response's
 *   own `Cache-Control` (`s-maxage` wins over `max-age`) when present, falling
 *   back to the configured `ttlSeconds`. Responses marked `no-store` /
 *   `private` / `no-cache`, or carrying `Set-Cookie`, are never cached.
 * - **Request directives.** `Cache-Control: no-store` on the request bypasses
 *   the cache completely; `no-cache` bypasses the read but still refreshes the
 *   stored entry (the same directive the background SWR refresh uses, which
 *   makes revalidation recursion-safe).
 * - **stale-while-revalidate.** With `staleWhileRevalidateSeconds` plus a
 *   `revalidate` callback (typically wired to `app.fetch`), a stale-but-recent
 *   entry is served immediately (marked `X-Cache: STALE`) while a single,
 *   de-duplicated background refresh repopulates the cache.
 * - **Pluggable store.** {@link ResponseCacheStore} mirrors `SessionStore` /
 *   the rate-limit store, with an in-memory {@link MemoryResponseCacheStore}
 *   default; supply a shared backend (e.g. Redis) for multi-instance fleets.
 *
 * ## Cross-principal isolation (CWE-524)
 *
 * A shared response cache is only as safe as its key. Anything that varies the
 * response but not the key becomes a cross-principal disclosure: the next caller
 * of the same URL receives the previous caller's private body. This module is
 * fail-closed on every principal dimension the framework can see:
 *
 * - **Authority.** The key is built from the *effective request URI* (scheme +
 *   authority + path + query) per RFC 9111 §4, so one process serving several
 *   hostnames (vanity domains, subdomain-per-customer) never shares an entry
 *   across them.
 * - **Credentials.** Requests carrying `Authorization` **or** `Cookie` bypass
 *   the shared cache entirely unless the caller is identified (see
 *   {@link ResponseCacheOptions.principal}) or the header is explicitly declared
 *   shareable (see {@link ResponseCacheOptions.cacheAuthenticatedRequests}).
 * - **Tenant.** When `tenancy()` has resolved a tenant for the request, that
 *   tenant is folded into the key automatically — no `keyGenerator` wiring
 *   required, and it applies to a custom `keyGenerator` too.
 * - **Declared variants.** A response's own `Vary` header is honoured as a
 *   secondary key (RFC 9111 §4.1): an entry is replayed only to a request whose
 *   values for those fields match the ones it was stored with. `cors()` emits
 *   `Vary: Origin` and `compression()` emits `Vary: Accept-Encoding`, so
 *   without this one caller's `Access-Control-Allow-Origin` — or their gzipped
 *   body — would be served to the next. `Vary: *` is never stored.
 *
 * This module is dependency-free and uses only Web Standard
 * `Request`/`Response` + `Headers`, so it runs unchanged on Node, Bun, Deno,
 * Cloudflare Workers, and Vercel.
 *
 * @module
 * @since 0.37.0
 */

import type { BaseContext, Hooks } from "./types.js";
import { markSchemaValidatedResponse } from "./internal-response.js";

/** Internal `ctx.state` key carrying the pending cache key between hooks. */
const PENDING_STATE_KEY = "__responseCachePending";

/**
 * Marker stamped on the `Hooks` object returned by {@link responseCache}, so the
 * `App` boot guard can detect a cache mounted *ahead of* `tenancy()` — an order
 * in which the tenant is not yet in `ctx.state` when the cache key is built, and
 * automatic tenant partitioning therefore cannot protect the entry.
 *
 * @since 1.0.0
 */
export const RESPONSE_CACHE_HOOK_MARKER: unique symbol = Symbol.for(
  "daloyjs.response-cache.hook"
);

/**
 * `ctx.state` symbol under which `tenancy()` records the tenant it resolved for
 * the request, or its `TENANT_UNRESOLVED` sentinel when it ran and resolved
 * nothing. Either way the value is a string, so it partitions the cache key —
 * which keeps tenant-less traffic out of the resolved tenants' entries without
 * this module needing to know the sentinel's value.
 *
 * Re-derived from the global symbol registry rather than imported from
 * `tenancy.js` so that using `responseCache()` never pulls the tenancy module
 * into the bundle — the same technique `app.ts` uses for the MCP route marker.
 * Must match the string in `tenancy.ts`.
 *
 * @internal
 */
const TENANCY_RESOLVED_MARKER = Symbol.for("daloyjs.tenancy.resolved");

/**
 * Process-wide registry of in-memory stores shared by
 * {@link ResponseCacheOptions.groupId}.
 *
 * @internal
 */
const SHARED_RESPONSE_CACHE_STORES = new Map<string, MemoryResponseCacheStore>();

/**
 * Test-only helper that clears the process-wide shared stores used by
 * `responseCache({ groupId })`. Not part of the documented public API.
 *
 * @internal
 */
export function _resetSharedResponseCacheStoresForTests(): void {
  SHARED_RESPONSE_CACHE_STORES.clear();
}

// ---------- Public types ----------

/**
 * A cached HTTP response. The body is stored as standard base64 so arbitrary
 * binary payloads round-trip safely.
 */
export interface CachedResponse {
  /** HTTP status code of the cached response. */
  status: number;
  /** Response headers as `[name, value]` pairs (lower-cased by `Headers`). */
  headers: Array<[string, string]>;
  /** Base64-encoded response body (empty string for a bodyless response). */
  body: string;
  /** Creation time as ms since epoch (drives the `Age` header). */
  storedAt: number;
  /** End of the freshness window as ms since epoch. */
  freshUntil: number;
  /** End of the stale-while-revalidate window as ms since epoch. */
  staleUntil: number;
  /**
   * Lower-cased request-header names from the stored response's `Vary` header —
   * the secondary cache key per RFC 9111 §4.1. Absent when the response
   * declared no `Vary`.
   *
   * @since 1.0.0
   */
  vary?: string[];
  /**
   * The values {@link vary}'s fields had on the request that produced this
   * entry, length-prefix encoded. A stored entry is only reusable for a request
   * whose values re-encode identically.
   *
   * @since 1.0.0
   */
  varyKey?: string;
}

/**
 * Pluggable persistence backend for {@link responseCache}. All methods may be
 * synchronous or asynchronous. Implementations should treat an entry whose
 * `staleUntil` is in the past as "missing" and may lazily delete it.
 */
export interface ResponseCacheStore {
  /**
   * Fetch the cached entry for `key`, or `null` when absent / fully expired.
   */
  get(key: string): CachedResponse | null | Promise<CachedResponse | null>;
  /**
   * Persist `entry` under `key` with the given total time-to-live (freshness +
   * stale window) in milliseconds.
   */
  set(key: string, entry: CachedResponse, ttlMs: number): void | Promise<void>;
  /** Remove the cached entry for `key`. */
  delete(key: string): void | Promise<void>;
}

/** Options for the {@link responseCache} middleware. */
export interface ResponseCacheOptions {
  /** Pluggable persistence backend. Default: a fresh in-memory store. */
  store?: ResponseCacheStore;
  /**
   * Default freshness lifetime in seconds, used when the response carries no
   * `s-maxage` / `max-age`. Default: `60`.
   */
  ttlSeconds?: number;
  /**
   * Extra seconds a stale entry may be served while a background refresh runs.
   * Requires {@link revalidate}. Default: `0` (no stale serving).
   */
  staleWhileRevalidateSeconds?: number;
  /**
   * Background refresh callback, typically `(req) => app.fetch(req)`. Invoked
   * (fire-and-forget, de-duplicated per key) with a clone of the original
   * request carrying `Cache-Control: no-cache` so it bypasses the cached read
   * but still repopulates the entry. Required to enable
   * {@link staleWhileRevalidateSeconds}.
   */
  revalidate?: (request: Request) => Promise<Response> | Response;
  /**
   * HTTP methods eligible for caching. Default: `["GET", "HEAD"]`.
   */
  methods?: string[];
  /**
   * Decide whether a produced response is cacheable by status. Default: only
   * `200 OK`.
   */
  cacheableStatus?: (status: number) => boolean;
  /**
   * Request header names whose values partition the cache (e.g.
   * `["accept-language"]`). Their values are folded into the cache key.
   * Default: none.
   *
   * @remarks This is the *proactive* dimension list, applied to every request
   * before the handler runs. It is independent of — and additive to — the
   * `Vary` header a response declares for itself, which the cache always
   * honours as a secondary key (see {@link responseCache}).
   */
  varyHeaders?: string[];
  /**
   * Extra response headers to drop before an entry is stored, on top of the
   * built-in hop-by-hop / per-request set (`Age`, `Connection`,
   * `Transfer-Encoding`, `X-Request-Id`, …).
   *
   * Supply the name of a custom correlation or tracing header so it is not
   * frozen into the entry and replayed to every later caller — for example
   * `requestId({ header: "x-correlation-id" })` pairs with
   * `excludeHeaders: ["x-correlation-id"]`.
   *
   * @since 1.0.0
   */
  excludeHeaders?: readonly string[];
  /**
   * Derive the cache key **body** from the request. Default: method + the
   * effective request URI (scheme + authority + path + query) +
   * {@link varyHeaders} values. Return `null` to skip caching for this request.
   *
   * The resolved tenant and {@link principal} partition is applied *around*
   * whatever this returns, so a custom generator does not have to (and should
   * not bother to) fold them in itself — it cannot accidentally widen the
   * partition below what the framework knows about the caller.
   */
  keyGenerator?: (ctx: BaseContext<any, any>) => string | null;

  /**
   * Identify the caller, so responses to credentialed requests can be cached
   * *per principal* instead of bypassing the cache.
   *
   * Return a stable id for the calling principal (user id, tenant id, API-key
   * fingerprint — never the raw credential), or `null` / `undefined` when the
   * request is anonymous. The returned id is folded into the cache key.
   *
   * This is what makes cookie-authenticated caching safe: a session cookie
   * identifies a user that the cache key would otherwise ignore, so without a
   * `principal` such a request is not cached at all.
   *
   * ```ts
   * responseCache({
   *   ttlSeconds: 30,
   *   principal: (ctx) => ctx.state.session?.get<string>("userId") ?? null,
   * });
   * ```
   *
   * @remarks Returning `null` for a request that *does* carry credentials is
   * treated as "cannot identify this caller", and the request bypasses the cache
   * rather than sharing an anonymous entry.
   * @since 1.0.0
   */
  principal?: (ctx: BaseContext<any, any>) => string | null | undefined;
  /**
   * Maximum response body size (bytes) the middleware will buffer and store.
   * Larger responses pass through uncached. Default: `1048576` (1 MiB).
   */
  maxBodyBytes?: number;
  /**
   * Response header marking cache outcome (`HIT` / `MISS` / `STALE`). Set to
   * `null` to disable. Default: `"x-cache"`.
   */
  statusHeaderName?: string | null;
  /**
   * Share a single in-memory store across every `responseCache()` mount that
   * declares the same `groupId`. Only meaningful for the default in-memory
   * store.
   */
  groupId?: string;
  /**
   * Whether to cache responses to requests that carry credentials — an
   * `Authorization` header or a `Cookie` header. Default: `false` for both.
   *
   * A shared response cache keyed on the request URI does not include the
   * credential, so caching a credentialed response would serve one user's
   * private data to the next caller of the same URL (CWE-524 — cross-principal
   * cached-response disclosure). Per RFC 9111 §3.5 a shared cache MUST NOT
   * reuse a response to an `Authorization`-bearing request unless explicitly
   * permitted; `Cookie` is treated the same way because a session cookie is the
   * single most common way a response is made private.
   *
   * Pass a boolean to set both, or an object to control them independently —
   * useful when a public endpoint receives unrelated analytics cookies but must
   * never cache bearer-authenticated responses:
   *
   * ```ts
   * responseCache({ cacheAuthenticatedRequests: { cookie: true } });
   * ```
   *
   * Enable a dimension only when the response is genuinely shareable across
   * principals (e.g. public reference data behind a bearer gate). Otherwise
   * prefer {@link principal}, which keeps caching *and* keeps callers apart.
   *
   * @remarks Declaring the credential header in {@link varyHeaders} also counts
   * as handling it, since its value then partitions the key.
   * @since 0.40.0 — extended to `Cookie` and per-header control in 1.0.0.
   */
  cacheAuthenticatedRequests?: boolean | { authorization?: boolean; cookie?: boolean };
}

// ---------- Default store ----------

/** Options for {@link MemoryResponseCacheStore}. */
export interface MemoryResponseCacheStoreOptions {
  /**
   * Hard ceiling on retained entries. Default: `10_000`. Once reached, the
   * oldest-inserted entries are evicted — expired ones first.
   */
  maxEntries?: number;
  /**
   * Hard ceiling on retained body bytes. Default: `64 * 1024 * 1024` (64 MiB).
   *
   * An entry count alone does not bound memory: with the module's default
   * `maxBodyBytes` of 1 MiB, ten thousand entries is ten gigabytes. This is the
   * limit that actually caps the store's footprint.
   */
  maxBytes?: number;
}

/**
 * In-memory {@link ResponseCacheStore}. Suitable for tests and single-process
 * deployments.
 *
 * Expired entries are dropped on access. The map is bounded on **both** entry
 * count and retained body bytes ({@link MemoryResponseCacheStoreOptions}):
 * pruning expired entries alone cannot bound it, because every entry in a burst
 * of requests for distinct URLs is unexpired for the whole TTL. An attacker
 * rotating a query string would otherwise grow the map without limit until the
 * process runs out of memory.
 *
 * Eviction is FIFO over insertion order (expired entries first), which `Map`
 * gives in O(1) per eviction.
 */
export class MemoryResponseCacheStore implements ResponseCacheStore {
  private readonly map = new Map<string, CachedResponse>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  /** Running sum of `entry.body.length` over `map`, kept in step with writes. */
  private bytes = 0;

  /**
   * @param opts - Capacity limits; see {@link MemoryResponseCacheStoreOptions}.
   * @throws TypeError if either limit is not a positive integer.
   */
  constructor(opts: MemoryResponseCacheStoreOptions = {}) {
    const maxEntries = opts.maxEntries ?? 10_000;
    const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new TypeError("MemoryResponseCacheStore: maxEntries must be a positive integer.");
    }
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new TypeError("MemoryResponseCacheStore: maxBytes must be a positive integer.");
    }
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  /** @inheritDoc */
  get(key: string): CachedResponse | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.staleUntil <= Date.now()) {
      this.drop(key, entry);
      return null;
    }
    return entry;
  }

  /**
   * @inheritDoc
   * `_ttlMs` is part of the {@link ResponseCacheStore} contract but unused
   * here: the in-memory store derives freshness from `entry.freshUntil`.
   */
  set(key: string, entry: CachedResponse, _ttlMs?: number): void {
    const existing = this.map.get(key);
    if (existing) this.bytes -= existing.body.length;
    this.map.set(key, entry);
    this.bytes += entry.body.length;
    if (this.map.size > this.maxEntries || this.bytes > this.maxBytes) this.evict();
  }

  /** @inheritDoc */
  delete(key: string): void {
    const entry = this.map.get(key);
    if (entry) this.drop(key, entry);
  }

  /** Remove one entry, keeping the byte counter in step. */
  private drop(key: string, entry: CachedResponse): void {
    this.map.delete(key);
    this.bytes -= entry.body.length;
  }

  /**
   * Bring the map back under both limits: expired entries first, then
   * oldest-inserted, since `Map` iterates in insertion order.
   */
  private evict(): void {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (this.map.size <= this.maxEntries && this.bytes <= this.maxBytes) return;
      if (v.staleUntil <= now) this.drop(k, v);
    }
    for (const [k, v] of this.map) {
      if (this.map.size <= this.maxEntries && this.bytes <= this.maxBytes) return;
      this.drop(k, v);
    }
  }

  /** Test helper. Remove every entry. */
  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  /** Test helper. Number of stored entries (including expired). */
  size(): number {
    return this.map.size;
  }
}

// ---------- Internal helpers ----------

interface PendingCache {
  key: string;
  freshnessOverrideMs: number | null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Parse a `Cache-Control` header into a lower-cased directive map. */
function parseCacheControl(value: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!value) return out;
  for (const part of value.split(",")) {
    const token = part.trim();
    if (token.length === 0) continue;
    const eq = token.indexOf("=");
    if (eq === -1) {
      out.set(token.toLowerCase(), "");
    } else {
      out.set(token.slice(0, eq).trim().toLowerCase(), token.slice(eq + 1).trim());
    }
  }
  return out;
}

function parseSeconds(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw.replace(/^"|"$/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * Decide whether a freshly produced response may be cached and, if so, its
 * freshness lifetime override (ms) from `Cache-Control`. Returns `null` when
 * the response must not be cached.
 */
function freshnessFromResponse(res: Response): number | null | undefined {
  if (res.headers.has("set-cookie")) return null;
  const cc = parseCacheControl(res.headers.get("cache-control"));
  if (cc.has("no-store") || cc.has("private") || cc.has("no-cache")) return null;
  const sMaxAge = parseSeconds(cc.get("s-maxage"));
  if (sMaxAge !== null) return sMaxAge * 1_000;
  const maxAge = parseSeconds(cc.get("max-age"));
  if (maxAge !== null) return maxAge * 1_000;
  // No explicit directive: fall back to the configured ttl (undefined marker).
  return undefined;
}

/**
 * Build the default cache-key body: the method plus the **effective request
 * URI** (scheme + authority + path + query), plus any {@link
 * ResponseCacheOptions.varyHeaders} values.
 *
 * Including the authority is what keeps one process serving several hostnames
 * from sharing entries across them (RFC 9111 §4 keys a cache on the target URI,
 * which includes the authority). `Request.url` is already an absolute,
 * normalized serialization (host lower-cased, default port elided), so it is
 * used directly — no `URL` object is allocated on this hot path. Only the
 * fragment, which is meaningless to a cache and never sent by HTTP clients, is
 * trimmed.
 */
function defaultKey(ctx: BaseContext<any, any>, varyHeaders: string[]): string {
  const url = ctx.request.url;
  const hash = url.indexOf("#");
  let key = `${ctx.request.method} ${hash === -1 ? url : url.slice(0, hash)}`;
  for (const name of varyHeaders) {
    key += `\n${name}: ${ctx.request.headers.get(name) ?? ""}`;
  }
  return key;
}

/**
 * Append a length-prefixed `name=value` component to a cache-key partition.
 *
 * The length prefix makes the component unambiguous, so a principal id
 * containing the delimiter (or a whole forged key fragment) cannot be crafted to
 * collide with a different partition — cache-key injection.
 */
function appendPartition(partition: string, name: string, value: string): string {
  return `${partition}${name}=${value.length}:${value}\n`;
}

/**
 * Response headers that must never be persisted in a cache entry, because they
 * describe *this hop* or *this request* rather than the stored representation.
 *
 * - The RFC 9111 §3.1 / RFC 9110 §7.6.1 hop-by-hop set. Replaying a stored
 *   `Transfer-Encoding: chunked` onto a fixed-length cached body, or a stored
 *   `Connection` token, corrupts message framing for every later caller.
 * - `Age`, which is recomputed from `storedAt` on every serve.
 * - `X-Request-Id`, the default correlation id written by `requestId()`. It
 *   identifies the *one* request that populated the entry; replaying it makes
 *   every subsequent caller report a trace id belonging to someone else's
 *   request, and tells an attacker whether their own seed is still being
 *   served (a cache-state oracle).
 *
 * Extend for a custom correlation header via
 * {@link ResponseCacheOptions.excludeHeaders}.
 */
const NEVER_CACHED_HEADERS: ReadonlySet<string> = new Set([
  "age",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-request-id",
]);

/**
 * Split a response's `Vary` header into normalized field names.
 *
 * @param raw - Raw `Vary` header value, or `null` when absent.
 * @returns `"*"` when the response is declared unreusable by any secondary key,
 *   a sorted, de-duplicated, lower-cased field list otherwise (empty when the
 *   header is absent or lists nothing usable). Sorting makes the derived key
 *   independent of the order the emitting middleware happened to append in.
 */
function parseVary(raw: string | null): "*" | string[] {
  if (!raw) return [];
  const fields = new Set<string>();
  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase();
    if (!name) continue;
    if (name === "*") return "*";
    fields.add(name);
  }
  return [...fields].sort();
}

/**
 * Derive the secondary cache key for a request: the values it carries for each
 * field the stored response varies on.
 *
 * Uses the same length-prefixed encoding as {@link appendPartition}, so a header
 * value containing the delimiter cannot be crafted to collide with a different
 * variant.
 *
 * @param headers - The request's headers.
 * @param fields - Lower-cased field names from {@link parseVary}.
 * @returns An unambiguous encoding of those fields' values.
 */
function varyKeyFor(headers: Headers, fields: readonly string[]): string {
  let key = "";
  for (const name of fields) key = appendPartition(key, name, headers.get(name) ?? "");
  return key;
}

/**
 * Store key for one variant of a primary key.
 *
 * Variants live under their own keys so they coexist instead of evicting each
 * other. A single slot per primary key would make every alternation between
 * (say) a gzip client and an identity client a miss — and hand an attacker a
 * cache-defeat DoS: rotate `Origin` or `Accept-Encoding` and every request runs
 * the handler.
 *
 * The separator is a NUL byte, which cannot appear in a header value, so a
 * variant key can never collide with a primary key.
 */
function variantKey(primary: string, varyKey: string): string {
  return `${primary}\u0000v\u0000${varyKey}`;
}

function buildResponseFromCache(
  entry: CachedResponse,
  outcome: "HIT" | "STALE",
  statusHeaderName: string | null,
  isHead: boolean
): Response {
  const headers = new Headers();
  for (const [name, value] of entry.headers) headers.set(name, value);
  const ageSeconds = Math.max(0, Math.floor((Date.now() - entry.storedAt) / 1_000));
  headers.set("age", String(ageSeconds));
  if (statusHeaderName) headers.set(statusHeaderName, outcome);
  const body = isHead || entry.body === "" ? null : base64ToBytes(entry.body);
  return markSchemaValidatedResponse(
    new Response(body as BodyInit | null, { status: entry.status, headers })
  );
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

// ---------- Middleware ----------

/**
 * Server-side response cache middleware. Mount it ahead of the read endpoints
 * whose rendered bodies are safe to reuse for a short window.
 *
 * Behavior for an eligible method (see {@link ResponseCacheOptions.methods}):
 *
 * - **Fresh hit** → the stored response is served and the handler does not run
 *   (`X-Cache: HIT`, plus an `Age` header).
 * - **Stale hit within the SWR window** (requires
 *   {@link ResponseCacheOptions.revalidate}) → the stale response is served
 *   immediately (`X-Cache: STALE`) while a single background refresh runs.
 * - **Miss** → the handler runs; a cacheable response is stored
 *   (`X-Cache: MISS`).
 *
 * Request `Cache-Control: no-store` bypasses the cache entirely; `no-cache`
 * bypasses the read but still refreshes the stored entry. Responses marked
 * `no-store` / `private` / `no-cache`, carrying `Set-Cookie` or `Vary: *`,
 * failing {@link ResponseCacheOptions.cacheableStatus}, or larger than
 * {@link ResponseCacheOptions.maxBodyBytes} are never cached.
 *
 * A response that declares `Vary` is stored as a **variant**: the request's
 * values for those fields are recorded alongside it, and the entry is replayed
 * only to a request whose values match. A mismatch is a miss, so the handler
 * runs and the entry is re-stored for that variant. This applies to `Vary`
 * written by any middleware in the chain — notably `cors()` (`Origin`) and
 * `compression()` (`Accept-Encoding`) — with no configuration.
 *
 * @example
 * ```ts
 * import { App, responseCache } from "@daloyjs/core";
 *
 * const app = new App();
 * app.use(responseCache({ ttlSeconds: 30 }));
 *
 * // stale-while-revalidate, wired to the app itself:
 * app.use(
 *   responseCache({
 *     ttlSeconds: 30,
 *     staleWhileRevalidateSeconds: 300,
 *     revalidate: (req) => app.fetch(req),
 *   }),
 * );
 * ```
 *
 * @param opts - Response-cache configuration.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @since 0.37.0
 */
export function responseCache(opts: ResponseCacheOptions = {}): Hooks {
  const ttlSeconds = opts.ttlSeconds ?? 60;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("responseCache(): ttlSeconds must be a positive integer.");
  }
  const swrSeconds = opts.staleWhileRevalidateSeconds ?? 0;
  if (!Number.isInteger(swrSeconds) || swrSeconds < 0) {
    throw new Error("responseCache(): staleWhileRevalidateSeconds must be a non-negative integer.");
  }
  if (swrSeconds > 0 && typeof opts.revalidate !== "function") {
    throw new Error(
      "responseCache(): staleWhileRevalidateSeconds requires a revalidate callback (e.g. (req) => app.fetch(req))."
    );
  }
  const maxBodyBytes = opts.maxBodyBytes ?? 1_048_576;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new Error("responseCache(): maxBodyBytes must be a positive integer.");
  }

  const methods = new Set((opts.methods ?? ["GET", "HEAD"]).map((m) => m.toUpperCase()));
  const cacheableStatus = opts.cacheableStatus ?? ((status: number) => status === 200);
  const varyHeaders = (opts.varyHeaders ?? []).map((h) => h.toLowerCase());
  const principal = opts.principal;
  const excludedHeaders: ReadonlySet<string> = opts.excludeHeaders?.length
    ? new Set([...NEVER_CACHED_HEADERS, ...opts.excludeHeaders.map((h) => h.toLowerCase())])
    : NEVER_CACHED_HEADERS;

  // Resolve the per-header credential policy once, at construction. A credential
  // header counts as "handled" when the caller declared it shareable, or when it
  // is in `varyHeaders` (its value then partitions the key by itself).
  const credentialOptIn = opts.cacheAuthenticatedRequests;
  const optInAll = credentialOptIn === true;
  const authorizationHandled =
    optInAll ||
    (typeof credentialOptIn === "object" && credentialOptIn?.authorization === true) ||
    varyHeaders.includes("authorization");
  const cookieHandled =
    optInAll ||
    (typeof credentialOptIn === "object" && credentialOptIn?.cookie === true) ||
    varyHeaders.includes("cookie");
  const statusHeaderName =
    opts.statusHeaderName === null ? null : (opts.statusHeaderName ?? "x-cache").toLowerCase();
  const ttlMs = ttlSeconds * 1_000;
  const swrMs = swrSeconds * 1_000;
  const revalidate = opts.revalidate;

  let store: ResponseCacheStore;
  if (opts.store) {
    store = opts.store;
  } else if (opts.groupId) {
    let shared = SHARED_RESPONSE_CACHE_STORES.get(opts.groupId);
    if (!shared) {
      shared = new MemoryResponseCacheStore();
      SHARED_RESPONSE_CACHE_STORES.set(opts.groupId, shared);
    }
    store = shared;
  } else {
    store = new MemoryResponseCacheStore();
  }
  const keyPrefix = opts.groupId ? `${opts.groupId}:` : "";

  // De-duplicate concurrent background refreshes per key.
  const refreshing = new Set<string>();

  function backgroundRefresh(key: string, request: Request): void {
    if (!revalidate || refreshing.has(key)) return;
    refreshing.add(key);
    const refreshReq = new Request(request.url, {
      method: request.method,
      headers: new Headers(request.headers),
    });
    // Force a read-bypass so the refresh re-runs the handler and re-stores.
    refreshReq.headers.set("cache-control", "no-cache");
    void Promise.resolve()
      .then(() => revalidate(refreshReq))
      .catch(() => undefined)
      .finally(() => refreshing.delete(key));
  }

  const hooks: Hooks = {
    async beforeHandle(ctx) {
      const method = ctx.request.method.toUpperCase();
      if (!methods.has(method)) return undefined;

      const headers = ctx.request.headers;

      // Checked before `principal` runs so a fully bypassed request never pays
      // for the caller's callback.
      const reqCc = parseCacheControl(headers.get("cache-control"));
      if (reqCc.has("no-store")) return undefined;

      // Identify the caller, if the app can. A non-empty principal is folded
      // into the key below, which is what makes caching a credentialed response
      // safe: the entry belongs to that principal alone. Not wrapped in a
      // try/catch, matching `keyGenerator`: a throwing option is a bug in the
      // app, and swallowing it would hide the misconfiguration.
      const principalId = principal ? (principal(ctx) ?? null) : null;

      // RFC 9111 §3.5 / CWE-524: a shared cache keyed on the request URI must not
      // store or reuse a response to a credentialed request, or it would serve
      // one principal's private data to the next caller. `Cookie` counts as a
      // credential alongside `Authorization` — a session cookie is the most
      // common way a response becomes private. An unhandled credential is only
      // safe once `principal` has named the caller.
      if (
        !principalId &&
        ((!authorizationHandled && headers.has("authorization")) ||
          (!cookieHandled && headers.has("cookie")))
      ) {
        return undefined;
      }

      const rawKey = opts.keyGenerator ? opts.keyGenerator(ctx) : defaultKey(ctx, varyHeaders);
      if (rawKey === null) return undefined;

      // Partition the key by everything the framework knows about the caller
      // that the URI does not already express. Applied around `keyGenerator`
      // output too, so a custom generator cannot widen the partition. Skipped
      // entirely — no allocation — for the common unpartitioned public request.
      let partition = "";
      const tenant = (ctx.state as Record<PropertyKey, unknown>)[TENANCY_RESOLVED_MARKER];
      if (typeof tenant === "string") {
        partition = appendPartition(partition, "tenant", tenant);
      }
      if (principalId) {
        partition = appendPartition(partition, "principal", principalId);
      }

      const key = `${keyPrefix}${partition}${rawKey}`;

      // `no-cache` bypasses the read but still allows a fresh write below.
      const bypassRead = reqCc.has("no-cache");
      if (!bypassRead) {
        const getResult = store.get(key);
        let entry = isPromiseLike(getResult) ? await getResult : getResult;
        let servedKey = key;

        // RFC 9111 §4.1: an entry stored for a response that declared `Vary`
        // is reusable only for a request whose values for those fields match
        // the ones it was stored with. Without this, `cors()`'s `Vary: Origin`
        // and `compression()`'s `Vary: Accept-Encoding` are silently ignored
        // and one caller's variant — their `Access-Control-Allow-Origin`, their
        // content-coding, their negotiated language — is served to the next.
        //
        // The entry at the primary key doubles as the hint that tells us *which*
        // fields matter, so the common single-variant case costs one `get`. On a
        // mismatch we know the field list and can look the right variant up
        // directly, which is what keeps several variants of one URL alive at
        // once instead of each evicting the last.
        if (entry?.vary?.length) {
          const wanted = varyKeyFor(headers, entry.vary);
          if (entry.varyKey !== wanted) {
            servedKey = variantKey(key, wanted);
            const variantResult = store.get(servedKey);
            entry = isPromiseLike(variantResult) ? await variantResult : variantResult;
            // A stored variant records the field list it was keyed on; if that
            // has since changed (the handler now varies on something else), the
            // recorded key no longer means what we just computed.
            if (entry && varyKeyFor(headers, entry.vary ?? []) !== entry.varyKey) entry = null;
          }
        }

        if (entry) {
          const now = Date.now();
          if (now < entry.freshUntil) {
            return buildResponseFromCache(entry, "HIT", statusHeaderName, method === "HEAD");
          }
          if (revalidate && now < entry.staleUntil) {
            backgroundRefresh(servedKey, ctx.request);
            return buildResponseFromCache(entry, "STALE", statusHeaderName, method === "HEAD");
          }
        }
      }

      (ctx.state as Record<string, unknown>)[PENDING_STATE_KEY] = {
        key,
        freshnessOverrideMs: null,
      } satisfies PendingCache;
      return undefined;
    },

    async onSend(res, ctx) {
      if (!ctx) return undefined;
      const state = ctx.state as Record<string, unknown>;
      const pending = state[PENDING_STATE_KEY] as PendingCache | undefined;
      if (!pending) return undefined;
      delete state[PENDING_STATE_KEY];

      if (!cacheableStatus(res.status)) {
        if (statusHeaderName) res.headers.set(statusHeaderName, "MISS");
        return undefined;
      }

      const freshness = freshnessFromResponse(res);
      if (freshness === null) {
        // Response opted out of caching (no-store / private / Set-Cookie ...).
        if (statusHeaderName) res.headers.set(statusHeaderName, "MISS");
        return undefined;
      }

      // RFC 9111 §4.1: `Vary: *` declares the response unreusable for any other
      // request, whatever its headers. There is no secondary key that can make
      // it safe, so it is never stored.
      const vary = parseVary(res.headers.get("vary"));
      if (vary === "*") {
        if (statusHeaderName) res.headers.set(statusHeaderName, "MISS");
        return undefined;
      }

      const buf = new Uint8Array(await res.clone().arrayBuffer());
      if (buf.byteLength > maxBodyBytes) {
        if (statusHeaderName) res.headers.set(statusHeaderName, "MISS");
        return undefined;
      }

      const headers: Array<[string, string]> = [];
      res.headers.forEach((value, name) => {
        // Hop-by-hop and per-request headers describe this exchange, not the
        // stored representation; replaying them corrupts framing or leaks one
        // caller's correlation id to the next.
        if (excludedHeaders.has(name)) return;
        headers.push([name, value]);
      });

      const now = Date.now();
      const freshMs = freshness ?? ttlMs;
      const ttl = freshMs + swrMs;
      const varyKey = vary.length ? varyKeyFor(ctx.request.headers, vary) : undefined;
      const entry: CachedResponse = {
        status: res.status,
        headers,
        body: buf.byteLength ? bytesToBase64(buf) : "",
        storedAt: now,
        freshUntil: now + freshMs,
        staleUntil: now + ttl,
        ...(varyKey === undefined ? {} : { vary, varyKey }),
      };

      // A varying response is written twice: once under its own variant key, so
      // it survives other variants of the same URL being cached, and once at
      // the primary key, where the next lookup reads it as the hint naming the
      // fields that matter. The primary copy is the most recently stored
      // variant, so that one is served in a single `get`.
      if (varyKey !== undefined) {
        const variantResult = store.set(variantKey(pending.key, varyKey), entry, ttl);
        if (isPromiseLike(variantResult)) await variantResult;
      }
      const setResult = store.set(pending.key, entry, ttl);
      if (isPromiseLike(setResult)) await setResult;
      if (statusHeaderName) res.headers.set(statusHeaderName, "MISS");
      return undefined;
    },
  };

  // Let the App boot guard see that a response cache is in this hook chain, and
  // where in the order it sits relative to `tenancy()`.
  (hooks as Record<PropertyKey, unknown>)[RESPONSE_CACHE_HOOK_MARKER] = true;
  return hooks;
}
