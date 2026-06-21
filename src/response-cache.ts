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
 * This module is dependency-free and uses only Web Standard
 * `Request`/`Response` + `Headers`, so it runs unchanged on Node, Bun, Deno,
 * Cloudflare Workers, and Vercel.
 *
 * @module
 * @since 0.37.0
 */

import type { BaseContext, Hooks } from "./types.js";

/** Internal `ctx.state` key carrying the pending cache key between hooks. */
const PENDING_STATE_KEY = "__responseCachePending";

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
   */
  varyHeaders?: string[];
  /**
   * Derive the cache key from the request. Default: method + URL +
   * {@link varyHeaders} values. Return `null` to skip caching for this request.
   */
  keyGenerator?: (ctx: BaseContext<any, any>) => string | null;
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
   * Whether to cache responses to requests that carry an `Authorization`
   * header. Default: `false`.
   *
   * A shared response cache keyed on method + URL (the default) does not
   * include the credential, so caching an authenticated response would serve
   * one user's private data to the next user requesting the same URL
   * (CWE-524 — cross-tenant cached-response disclosure). For that reason, and
   * per RFC 9111 §3.5 (a shared cache MUST NOT reuse a response to an
   * `Authorization`-bearing request unless explicitly permitted), such
   * requests bypass the cache entirely by default.
   *
   * Set this to `true` only when the response is genuinely shareable across
   * principals (e.g. public reference data served behind a bearer gate) — and
   * then also add the credential to {@link varyHeaders} or a custom
   * {@link keyGenerator} so distinct callers cannot collide.
   *
   * @since 0.40.0
   */
  cacheAuthenticatedRequests?: boolean;
}

// ---------- Default store ----------

/**
 * In-memory {@link ResponseCacheStore}. Suitable for tests and single-process
 * deployments. Expired entries are dropped on access; the map is
 * opportunistically pruned so it cannot grow without bound.
 */
export class MemoryResponseCacheStore implements ResponseCacheStore {
  private readonly map = new Map<string, CachedResponse>();

  /** @inheritDoc */
  get(key: string): CachedResponse | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.staleUntil <= Date.now()) {
      this.map.delete(key);
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
    this.map.set(key, entry);
    if (this.map.size > 10_000) this.prune();
  }

  /** @inheritDoc */
  delete(key: string): void {
    this.map.delete(key);
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.staleUntil <= now) this.map.delete(k);
    }
  }

  /** Test helper. Remove every entry. */
  clear(): void {
    this.map.clear();
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

function defaultKey(ctx: BaseContext<any, any>, varyHeaders: string[]): string {
  const url = new URL(ctx.request.url);
  let key = `${ctx.request.method} ${url.pathname}${url.search}`;
  for (const name of varyHeaders) {
    key += `\n${name}: ${ctx.request.headers.get(name) ?? ""}`;
  }
  return key;
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
  return new Response(body as BodyInit | null, { status: entry.status, headers });
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
 * `no-store` / `private` / `no-cache`, carrying `Set-Cookie`, failing
 * {@link ResponseCacheOptions.cacheableStatus}, or larger than
 * {@link ResponseCacheOptions.maxBodyBytes} are never cached.
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
  const cacheAuthenticatedRequests = opts.cacheAuthenticatedRequests === true;
  const cacheableStatus = opts.cacheableStatus ?? ((status: number) => status === 200);
  const varyHeaders = (opts.varyHeaders ?? []).map((h) => h.toLowerCase());
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

  return {
    async beforeHandle(ctx) {
      const method = ctx.request.method.toUpperCase();
      if (!methods.has(method)) return undefined;

      // RFC 9111 §3.5 / CWE-524: a shared cache keyed on method+URL must not
      // store or reuse a response to an Authorization-bearing request, or it
      // would serve one principal's private data to the next caller. Opt in
      // via `cacheAuthenticatedRequests` for genuinely shareable content.
      if (!cacheAuthenticatedRequests && ctx.request.headers.has("authorization")) {
        return undefined;
      }

      const reqCc = parseCacheControl(ctx.request.headers.get("cache-control"));
      if (reqCc.has("no-store")) return undefined;

      const rawKey = opts.keyGenerator ? opts.keyGenerator(ctx) : defaultKey(ctx, varyHeaders);
      if (rawKey === null) return undefined;
      const key = `${keyPrefix}${rawKey}`;

      // `no-cache` bypasses the read but still allows a fresh write below.
      const bypassRead = reqCc.has("no-cache");
      if (!bypassRead) {
        const getResult = store.get(key);
        const entry = isPromiseLike(getResult) ? await getResult : getResult;
        if (entry) {
          const now = Date.now();
          if (now < entry.freshUntil) {
            return buildResponseFromCache(entry, "HIT", statusHeaderName, method === "HEAD");
          }
          if (revalidate && now < entry.staleUntil) {
            backgroundRefresh(key, ctx.request);
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

      const buf = new Uint8Array(await res.clone().arrayBuffer());
      if (buf.byteLength > maxBodyBytes) {
        if (statusHeaderName) res.headers.set(statusHeaderName, "MISS");
        return undefined;
      }

      const headers: Array<[string, string]> = [];
      res.headers.forEach((value, name) => {
        // `Age` is recomputed on every serve; never persist a stale one.
        if (name === "age") return;
        headers.push([name, value]);
      });

      const now = Date.now();
      const freshMs = freshness ?? ttlMs;
      const entry: CachedResponse = {
        status: res.status,
        headers,
        body: buf.byteLength ? bytesToBase64(buf) : "",
        storedAt: now,
        freshUntil: now + freshMs,
        staleUntil: now + freshMs + swrMs,
      };
      const setResult = store.set(pending.key, entry, freshMs + swrMs);
      if (isPromiseLike(setResult)) await setResult;
      if (statusHeaderName) res.headers.set(statusHeaderName, "MISS");
      return undefined;
    },
  };
}
