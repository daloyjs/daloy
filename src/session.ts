/**
 * Edge-friendly session primitive.
 *
 * Implements signed session cookies plus a pluggable session store. The cookie
 * format is `${sid}.${signature}` where `signature` is a URL-safe base64
 * HMAC-SHA256 of the session id. Multiple secrets can be passed to support
 * graceful key rotation: the first secret is always used for signing, while
 * any of the configured secrets accept incoming cookies. Every signature
 * comparison is timing-safe.
 *
 * The default {@link MemorySessionStore} is suitable for tests and single-
 * process Node processes. Production deployments should pass a `SessionStore`
 * backed by Redis, Cloudflare KV, Vercel KV, or any other shared store.
 *
 * The module is dependency-free and uses Web Crypto (`crypto.subtle`), so it
 * works on Node, Bun, Deno, Cloudflare Workers, and Vercel.
 */

import type { BaseContext, Hooks } from "./types.js";
import {
  assertCookieAttributes,
  readRequestCookie,
  serializeClearCookie,
  serializeCookie,
} from "./cookie.js";
import { timingSafeEqual } from "./security.js";

const DEFAULT_COOKIE_NAME = "__Host-daloy.sid";

/**
 * Marker stamped on the `Hooks` object returned by {@link session}. Used
 * by the boot guard so the framework can detect that a session
 * subsystem is installed and pair it with `csrf()` / a strong production
 * secret. Third-party session helpers that want to participate in the
 * guard can stamp the same marker and expose their secrets via
 * {@link SESSION_SECRETS_MARKER}.
 *
 * @since 0.17.0
 */
export const SESSION_HOOK_MARKER: unique symbol = Symbol.for("daloyjs.session.hook");

/**
 * Marker stamped on the `Hooks` object returned by {@link session} that
 * carries the array of secrets passed to the helper. Used by the
 * boot guard to refuse-to-boot when production secrets are too short or
 * match a well-known placeholder.
 *
 * @since 0.17.0
 */
export const SESSION_SECRETS_MARKER: unique symbol = Symbol.for("daloyjs.session.secrets");

// ---------- Public types ----------

/** A persisted session entry as stored by a {@link SessionStore}. */
export interface SessionRecord {
  /**
   * Arbitrary JSON-serializable session payload. Mutating this object (including
   * nested properties and array elements via the proxy on
   * `ctx.state.session.data`) marks the session dirty so it is persisted on
   * the response. Prefer plain objects/arrays/primitives; non-cloneable
   * values (functions, DOM nodes) are not supported.
   */
  data: Record<string, unknown>;
  /** Absolute expiration as ms since epoch. */
  expiresAt: number;
}

/**
 * Pluggable persistence backend for sessions. All methods may be sync or async.
 * Implementations should treat `expiresAt` in the past as "missing" and may
 * lazily delete expired records.
 */
export interface SessionStore {
  /** Load the record for a session id, or `null` when missing/expired. */
  get(sid: string): SessionRecord | null | Promise<SessionRecord | null>;
  /** Persist (create or overwrite) the record for a session id. */
  set(sid: string, record: SessionRecord): void | Promise<void>;
  /** Delete the record for a session id; a no-op when it does not exist. */
  destroy(sid: string): void | Promise<void>;
  /** Optional fast-path for rolling sessions; falls back to `set()` if omitted. */
  touch?(sid: string, expiresAt: number): void | Promise<void>;
}

/** Attributes for the session id cookie set by the {@link session} middleware. */
export interface SessionCookieOptions {
  /** `Strict` | `Lax` | `None`. Default: `"Lax"`. */
  sameSite?: "Strict" | "Lax" | "None";
  /** Default: `true`. Required when `sameSite` is `"None"` or with `__Host-` cookie names. */
  secure?: boolean;
  /** Default: `"/"`. */
  path?: string;
  /** Optional `Domain=` attribute. Cannot be combined with a `__Host-` cookie name. */
  domain?: string;
  /** Optional `Max-Age=` (seconds). When omitted the cookie is a session cookie. */
  maxAgeSeconds?: number;
  /** Emit `Partitioned` (CHIPS) for cross-site contexts. Default: `false`. */
  partitioned?: boolean;
  /** Default: `true`. Sessions are server-side state, never readable by JS. */
  httpOnly?: boolean;
}

/** Options for the {@link session} middleware. */
export interface SessionOptions {
  /**
   * HMAC secret(s) used to sign session cookies. Pass an array to rotate
   * secrets without invalidating existing sessions: the first entry is used to
   * sign new cookies; any entry verifies incoming cookies. Each secret must be
   * a non-empty string of at least 16 characters.
   */
  secret: string | string[];
  /** Cookie name carrying the session id. Default: `"__Host-daloy.sid"`. */
  cookieName?: string;
  /** Cookie attributes (see {@link SessionCookieOptions}). */
  cookieOptions?: SessionCookieOptions;
  /** Pluggable persistence backend. Default: a fresh in-memory store. */
  store?: SessionStore;
  /** Default session lifetime in seconds. Default: `86400` (1 day). */
  ttlSeconds?: number;
  /**
   * Reset the session expiration on every access. Default: `true`.
   * Disable for fixed-duration sessions.
   */
  rolling?: boolean;
  /** Override the random session-id generator (32 bytes URL-safe by default). */
  generator?: () => string;
  /**
   * Persist a brand-new session and set its cookie even when the handler did
   * not touch it. Default: `false` (GDPR-friendly: no cookie until consent or
   * first write). Set to `true` to issue a session id on every first request.
   */
  saveUninitialized?: boolean;
}

/** Per-request session API exposed on `ctx.state.session`. */
export type SessionContext = {
  /** Current session id. Refreshed by `regenerate()`. */
  readonly id: string;
  /**
   * Session payload. Top-level and nested mutations (including array element
   * writes) mark the session dirty so {@link SessionStore.set} runs on the
   * response. Prefer `set`/`delete` for top-level keys when you do not need
   * nested objects.
   */
  readonly data: Record<string, unknown>;
  /** Read a single payload key. */
  get<T = unknown>(key: string): T | undefined;
  /** Set a payload key. Marks the session dirty. */
  set(key: string, value: unknown): void;
  /** Delete a payload key. Marks the session dirty. */
  delete(key: string): void;
  /** Drop all server-side state and clear the cookie on the response. */
  destroy(): void;
  /** Issue a new session id (defense against fixation). Carries `data` over by default; pass `{ keepData: false }` to start fresh. */
  regenerate(opts?: { keepData?: boolean }): Promise<string>;
};

const STATE_KEY = "session";
const STATE_INTERNAL = "__sessionInternal";

// ---------- Implementation ----------

interface SessionInternal {
  cookieName: string;
  cookieOpts: Required<SessionCookieOptions>;
  store: SessionStore;
  signers: Signer[];
  ttlMs: number;
  rolling: boolean;
  generator: () => string;
  saveUninitialized: boolean;
  /** Original session id loaded from the cookie (null if none). */
  originalId: string | null;
  /** Whether the request carried a cookie with this name, even if invalid. */
  hadCookie: boolean;
  /** Active session id (after regenerate()). */
  activeId: string | null;
  /** Whether the in-memory data was changed. */
  dirty: boolean;
  /** Whether destroy() was called. */
  destroyed: boolean;
  /** Whether regenerate() rotated the cookie. */
  regenerated: boolean;
  /** Whether the active session was newly created this request. */
  created: boolean;
  /**
   * The raw (un-proxied) session data object wrapped by the dirty-tracking
   * proxy. `structuredClone` rejects a Proxy, so the persist path clones this
   * plain object rather than `ctx.state.session.data`.
   */
  rawData: Record<string, unknown>;
}

interface Signer {
  sign(value: string): Promise<string>;
  verify(value: string, signature: string): Promise<boolean>;
}

const enc = new TextEncoder();

function getSubtle(): SubtleCrypto {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      "session(): Web Crypto (crypto.subtle) is required. Provide a polyfill in environments without it."
    );
  }
  return c.subtle;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa is defined on every supported runtime.
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeSigner(secret: string): Signer {
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error(
      "session(): each secret must be a string of at least 16 characters — it is the HMAC key " +
        "that signs every session cookie, so a short or guessable value lets an attacker forge sessions. " +
        "Generate one with `openssl rand -base64 32` and load it from an env var or secret manager " +
        "(never hard-code or commit it). See https://daloyjs.dev/docs/security/session."
    );
  }
  let keyPromise: Promise<CryptoKey> | null = null;
  const getKey = () => {
    if (!keyPromise) {
      keyPromise = getSubtle().importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
    }
    return keyPromise;
  };
  return {
    async sign(value) {
      const key = await getKey();
      const sig = new Uint8Array(await getSubtle().sign("HMAC", key, enc.encode(value)));
      return bytesToBase64Url(sig);
    },
    async verify(value, signature) {
      const expected = await this.sign(value);
      return timingSafeEqual(expected, signature);
    },
  };
}

function generateSessionId(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) {
    throw new Error(
      "session(): Web Crypto getRandomValues is required for the default id generator."
    );
  }
  const buf = new Uint8Array(32);
  c.getRandomValues(buf);
  return bytesToBase64Url(buf);
}

function sessionCookieAttributes(opts: Required<SessionCookieOptions>): SessionCookieOptions {
  return {
    sameSite: opts.sameSite,
    secure: opts.secure,
    path: opts.path,
    domain: opts.domain || undefined,
    maxAgeSeconds: opts.maxAgeSeconds,
    partitioned: opts.partitioned,
    httpOnly: opts.httpOnly,
  };
}

function markDirty(internal: SessionInternal): void {
  internal.dirty = true;
}

/**
 * Deep-clone a session payload so store load/store never shares nested object
 * references with the live request-scoped data.
 *
 * Prefers {@link structuredClone} (available on every supported runtime:
 * Node >= 17, Deno, Bun, Workers, Vercel edge). Unlike a JSON round-trip it
 * preserves `Date`, `Map`, `Set`, typed arrays, `BigInt`, and `undefined`
 * property values, and it handles cyclic graphs — so a session that legitimately
 * holds those values is neither silently corrupted (JSON stringifies a `Date`
 * to a string and drops `undefined`) nor rejected (JSON throws on `BigInt` or a
 * cycle). Falls back to the JSON round-trip only for the rare value
 * `structuredClone` cannot copy (e.g. a function), which is unsupported in a
 * session payload anyway.
 *
 * @param value - Session data tree (a plain object).
 * @returns An independent deep copy.
 */
function cloneSessionData(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value) as Record<string, unknown>;
    } catch {
      // structuredClone throws on non-cloneable values (functions, symbols);
      // fall through to the JSON round-trip for best-effort compatibility.
    }
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/**
 * Whether a value should be wrapped by the deep dirty-tracking proxy: only
 * plain objects and arrays. Exotic objects (`Date`, `Map`, `Set`, `RegExp`,
 * typed arrays, class instances) are returned unwrapped so methods that rely
 * on an internal slot as `this` (e.g. `Date.prototype.getTime`) keep working —
 * a proxy would break them. Reassigning such a value on its parent is still
 * dirty-tracked; only in-place internal mutation of the exotic value is not.
 *
 * @param value - Candidate nested value.
 * @returns `true` for plain objects / arrays.
 */
function isProxyableContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursive proxy that marks the session dirty on any nested set/delete,
 * including array element assignment. Nested plain objects and arrays returned
 * from `get` are re-wrapped so mutations deep in the tree are observed.
 *
 * Proxies are memoized per underlying target in `cache` (a {@link WeakMap}), so
 * reading the same nested object twice yields the *same* proxy and object
 * identity is preserved (`data.user === data.user`). The cache is scoped to a
 * single session context (one request), so it never leaks across requests and
 * its keys are collected with their targets.
 *
 * @param target - Underlying plain object/array held by the session.
 * @param onDirty - Invoked on every successful mutation.
 * @param cache - Per-context target→proxy memo table.
 * @returns A proxy with the same surface as `target`.
 */
function createDeepDirtyProxy<T extends object>(
  target: T,
  onDirty: () => void,
  cache: WeakMap<object, object>
): T {
  const existing = cache.get(target);
  if (existing) return existing as T;
  const proxy = new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver);
      if (isProxyableContainer(value)) {
        return createDeepDirtyProxy(value, onDirty, cache);
      }
      return value;
    },
    set(t, prop, value, receiver) {
      const ok = Reflect.set(t, prop, value, receiver);
      if (ok) onDirty();
      return ok;
    },
    deleteProperty(t, prop) {
      const had = Reflect.has(t, prop);
      const ok = Reflect.deleteProperty(t, prop);
      if (ok && had) onDirty();
      return ok;
    },
  }) as T;
  cache.set(target, proxy);
  return proxy;
}

function makeSessionContext(
  id: string,
  data: Record<string, unknown>,
  internal: SessionInternal,
  regenerate: (keepData: boolean) => Promise<string>
): SessionContext {
  const onDirty = (): void => {
    markDirty(internal);
  };
  // Per-request memo table so nested reads return a stable proxy identity.
  const proxyCache = new WeakMap<object, object>();
  const proxy = createDeepDirtyProxy(data, onDirty, proxyCache);
  let currentId = id;
  return {
    get id() {
      return currentId;
    },
    get data() {
      return proxy;
    },
    get<T = unknown>(key: string): T | undefined {
      return data[key] as T | undefined;
    },
    set(key, value) {
      data[key] = value;
      markDirty(internal);
    },
    delete(key) {
      if (key in data) {
        delete data[key];
        markDirty(internal);
      }
    },
    destroy() {
      for (const k of Object.keys(data)) delete data[k];
      internal.destroyed = true;
      internal.dirty = true;
    },
    async regenerate(opts) {
      const keepData = opts?.keepData !== false;
      const next = await regenerate(keepData);
      currentId = next;
      return next;
    },
  };
}

// ---------- Stores ----------

/**
 * In-memory `SessionStore`. Suitable for tests and single-process deployments.
 * Expired records are dropped on access.
 */
export class MemorySessionStore implements SessionStore {
  private readonly map = new Map<string, SessionRecord>();

  /** Load a record; expired records are deleted and reported as `null`. */
  get(sid: string): SessionRecord | null {
    const rec = this.map.get(sid);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      this.map.delete(sid);
      return null;
    }
    return rec;
  }

  /** Store (or overwrite) a record for a session id. */
  set(sid: string, record: SessionRecord): void {
    this.map.set(sid, record);
  }

  /** Remove the record for a session id, if present. */
  destroy(sid: string): void {
    this.map.delete(sid);
  }

  /** Extend an existing record's expiry (ms since epoch) without rewriting data. */
  touch(sid: string, expiresAt: number): void {
    const rec = this.map.get(sid);
    if (rec) rec.expiresAt = expiresAt;
  }

  /** Test helper. Remove every record. */
  clear(): void {
    this.map.clear();
  }

  /** Test helper. Number of stored records (including expired). */
  size(): number {
    return this.map.size;
  }
}

// ---------- Middleware ----------

/**
 * Session middleware. Reads (and verifies) a signed session cookie on every
 * request, exposes a typed `ctx.state.session` API, and writes back any
 * mutations on the response.
 *
 * @example
 * ```ts
 * import { App, session } from "@daloyjs/core";
 *
 * declare module "@daloyjs/core" {
 *   interface AppState {
 *     session: import("@daloyjs/core").SessionContext;
 *   }
 * }
 *
 * const app = new App();
 * app.use(session({ secret: process.env.SESSION_SECRET! }));
 * ```
 *
 * @param opts Secrets, cookie attributes, store, TTL, and rolling behavior;
 *   see {@link SessionOptions}. Cookies default to `__Host-` prefixed,
 *   `HttpOnly`, `Secure`, `SameSite=Lax`.
 * @returns A {@link Hooks} object that loads/verifies the session before the
 *   handler and persists mutations plus the `Set-Cookie` header afterwards.
 * @throws Error at setup time on missing/short secrets, invalid cookie
 *   attribute combinations, or a non-positive `ttlSeconds`.
 */
export function session(opts: SessionOptions): Hooks {
  const cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;

  const secrets = Array.isArray(opts.secret) ? opts.secret : [opts.secret];
  if (secrets.length === 0) throw new Error("session(): at least one secret is required.");
  const signers = secrets.map(makeSigner);

  const cookieOverrides = opts.cookieOptions ?? {};
  const cookieOpts: Required<SessionCookieOptions> = {
    sameSite: cookieOverrides.sameSite ?? "Lax",
    secure: cookieOverrides.secure ?? true,
    path: cookieOverrides.path ?? "/",
    domain: cookieOverrides.domain ?? "",
    maxAgeSeconds: cookieOverrides.maxAgeSeconds ?? 0,
    partitioned: cookieOverrides.partitioned ?? false,
    httpOnly: cookieOverrides.httpOnly ?? true,
  };
  assertCookieAttributes({
    scope: "session()",
    name: cookieName,
    attributes: sessionCookieAttributes(cookieOpts),
  });

  const ttlSeconds = opts.ttlSeconds ?? 86_400;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("session(): ttlSeconds must be a positive integer.");
  }
  const ttlMs = ttlSeconds * 1000;
  const rolling = opts.rolling !== false;
  const store = opts.store ?? new MemorySessionStore();
  const generator = opts.generator ?? generateSessionId;
  const saveUninitialized = opts.saveUninitialized === true;

  const hooks: Hooks = {
    async beforeHandle(ctx) {
      const internal: SessionInternal = {
        cookieName,
        cookieOpts,
        store,
        signers,
        ttlMs,
        rolling,
        generator,
        saveUninitialized,
        originalId: null,
        hadCookie: false,
        activeId: null,
        dirty: false,
        destroyed: false,
        regenerated: false,
        created: false,
        rawData: {},
      };

      const raw = readRequestCookie(ctx.request.headers.get("cookie"), cookieName);
      internal.hadCookie = raw !== null;
      let data: Record<string, unknown> = {};
      let id: string | null = null;

      if (raw) {
        const dot = raw.lastIndexOf(".");
        if (dot > 0 && dot < raw.length - 1) {
          const candidateId = raw.slice(0, dot);
          const sig = raw.slice(dot + 1);
          for (const signer of signers) {
            // eslint-disable-next-line no-await-in-loop
            if (await signer.verify(candidateId, sig)) {
              const rec = await store.get(candidateId);
              if (rec && rec.expiresAt > Date.now()) {
                id = candidateId;
                // Deep-clone so nested mutations cannot mutate the store's
                // retained object graph without going through dirty tracking.
                data = rec.data ? cloneSessionData(rec.data) : {};
              }
              break;
            }
          }
        }
      }

      if (!id) {
        id = generator();
        if (!id) throw new Error("session(): generator returned an empty id.");
        internal.created = true;
      } else {
        internal.originalId = id;
      }
      internal.activeId = id;

      const regenerate = async (keepData: boolean): Promise<string> => {
        // Only destroy a persisted session id. An id created earlier this
        // request (or a prior mid-request rotation) was never written to the
        // store, so there is nothing to destroy — we just discard it.
        if (internal.activeId && internal.originalId === internal.activeId) {
          await store.destroy(internal.activeId);
        }
        const next = generator();
        if (!next) throw new Error("session(): generator returned an empty id.");
        if (!keepData) {
          for (const k of Object.keys(data)) delete data[k];
        }
        internal.activeId = next;
        internal.regenerated = true;
        internal.dirty = true;
        internal.destroyed = false;
        internal.created = false;
        internal.originalId = null;
        return next;
      };

      // Retain the raw object so onSend can deep-clone it directly.
      // `regenerate` mutates this same reference, so it stays authoritative.
      internal.rawData = data;
      const sessionCtx = makeSessionContext(id, data, internal, regenerate);
      const state = ctx.state as Record<string, unknown>;
      state[STATE_KEY] = sessionCtx;
      state[STATE_INTERNAL] = internal;
    },
    async onSend(res, ctx) {
      if (!ctx) return undefined;
      const state = ctx.state as Record<string, unknown>;
      const internal = state[STATE_INTERNAL] as SessionInternal | undefined;
      if (!internal) return undefined;

      if (internal.destroyed) {
        if (internal.originalId) await store.destroy(internal.originalId);
        // Clear stale or malformed client cookies too, not only verified sessions.
        if (internal.hadCookie) {
          res.headers.append(
            "set-cookie",
            serializeClearCookie(internal.cookieName, sessionCookieAttributes(internal.cookieOpts))
          );
        }
        return undefined;
      }

      // Clone the raw (un-proxied) data: structuredClone rejects a Proxy, and
      // the proxy writes through to this object so it holds every mutation.
      const data = internal.rawData;
      const sid = internal.activeId!;
      const expiresAt = Date.now() + internal.ttlMs;

      // A brand-new, untouched session is a no-op unless saveUninitialized is on.
      const initialized = internal.dirty || internal.regenerated || internal.originalId !== null;
      if (!initialized && !internal.saveUninitialized) return undefined;

      const mustPersist = internal.dirty || internal.created || internal.regenerated;

      if (mustPersist) {
        // Deep-clone so nested mutations persist as an independent tree and
        // never share references with the store.
        await store.set(sid, { data: cloneSessionData(data), expiresAt });
      } else if (internal.rolling) {
        if (store.touch) await store.touch(sid, expiresAt);
        else await store.set(sid, { data: cloneSessionData(data), expiresAt });
      }

      if (internal.regenerated && internal.originalId && internal.originalId !== sid) {
        await store.destroy(internal.originalId);
      }

      // Only refresh the cookie when something actually changed, the session
      // was just created, or rolling sessions need a sliding expiration.
      const mustWriteCookie = internal.created || internal.regenerated || internal.rolling;
      if (!mustWriteCookie) return undefined;

      const signer = internal.signers[0]!;
      const sig = await signer.sign(sid);
      res.headers.append(
        "set-cookie",
        serializeCookie(
          internal.cookieName,
          `${sid}.${sig}`,
          sessionCookieAttributes(internal.cookieOpts)
        )
      );
      return undefined;
    },
  };
  (hooks as Record<PropertyKey, unknown>)[SESSION_HOOK_MARKER] = true;
  (hooks as Record<PropertyKey, unknown>)[SESSION_SECRETS_MARKER] = secrets.slice();
  return hooks;
}

// ---------- Privilege-change rotation helper ----------

/** Options for {@link rotateSession}. */
export interface RotateSessionOptions {
  /**
   * Session data keys to watch, or a custom selector. When the watched value
   * changes during a handler, the helper calls `ctx.state.session.regenerate()`.
   * Default keys cover common privilege-bearing fields.
   */
  watch?: string | readonly string[] | ((ctx: BaseContext<any, any>) => unknown | Promise<unknown>);
  /** Carry existing data across the regenerated session id. Default: true. */
  keepData?: boolean;
}

const ROTATE_SESSION_SNAPSHOT_KEY = "__daloyRotateSessionSnapshot" as const;
const DEFAULT_ROTATE_SESSION_KEYS = [
  "userId",
  "accountId",
  "tenantId",
  "role",
  "roles",
  "scopes",
  "permissions",
  "privileges",
  "isAdmin",
] as const;

interface RotateSessionSnapshot {
  id: string;
  value: string;
}

function sessionFromContext(ctx: BaseContext<any, any>): SessionContext {
  const value = (ctx.state as Record<string, unknown>)[STATE_KEY];
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as SessionContext).regenerate !== "function"
  ) {
    throw new Error("rotateSession(): session() must run before rotateSession().");
  }
  return value as SessionContext;
}

async function readRotationWatchValue(
  ctx: BaseContext<any, any>,
  watch: RotateSessionOptions["watch"]
): Promise<unknown> {
  if (typeof watch === "function") return watch(ctx);
  const sessionCtx = sessionFromContext(ctx);
  const keys =
    typeof watch === "string"
      ? [watch]
      : Array.isArray(watch)
        ? watch
        : DEFAULT_ROTATE_SESSION_KEYS;
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = sessionCtx.data[key];
  return out;
}

function stableSnapshot(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "function") return `function:${value.name}`;
  if (typeof value === "symbol") return String(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSnapshot).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSnapshot(record[key])}`)
    .join(",")}}`;
}

/**
 * Automatically rotate the signed session id when privilege-bearing session
 * data changes during a handler. Mount after `session()` and before routes
 * that mutate login / role / scope / tenant state.
 *
 * This is a thin guard over `ctx.state.session.regenerate()`, so it inherits
 * session key-rotation arrays: old cookies verify with any configured secret
 * and rotated cookies are re-signed with the first/current secret.
 *
 * @param opts Which session keys (or computed value) to watch, and whether
 *   payload data survives rotation (`keepData`, default `true`); see
 *   {@link RotateSessionOptions}.
 * @returns A {@link Hooks} object that snapshots the watched value before the
 *   handler and regenerates the session id when it changed afterwards
 *   (session-fixation defense).
 * @since 0.23.0
 */
export function rotateSession(opts: RotateSessionOptions = {}): Hooks {
  const keepData = opts.keepData !== false;
  return {
    async beforeHandle(ctx) {
      const sessionCtx = sessionFromContext(ctx);
      const value = await readRotationWatchValue(ctx, opts.watch);
      (ctx.state as Record<string, unknown>)[ROTATE_SESSION_SNAPSHOT_KEY] = {
        id: sessionCtx.id,
        value: stableSnapshot(value),
      } satisfies RotateSessionSnapshot;
    },
    async afterHandle(ctx, result) {
      const snapshot = (ctx.state as Record<string, unknown>)[ROTATE_SESSION_SNAPSHOT_KEY] as
        | RotateSessionSnapshot
        | undefined;
      if (!snapshot) return result;
      const sessionCtx = sessionFromContext(ctx);
      if (sessionCtx.id !== snapshot.id) return result;
      const value = await readRotationWatchValue(ctx, opts.watch);
      if (stableSnapshot(value) !== snapshot.value) {
        await sessionCtx.regenerate({ keepData });
      }
      return result;
    },
  };
}

// ---------- Low-level signing helpers (re-exported for advanced use) ----------

/**
 * Sign an arbitrary string with HMAC-SHA256. Useful for building custom
 * signed cookies or tokens that do not need a session store.
 *
 * @param value String to sign; must not contain `.` (the separator).
 * @param secret HMAC key, at least 16 characters.
 * @returns `${value}.${sig}` where `sig` is URL-safe base64.
 * @throws Error when `value` contains `.` or the secret is too short.
 */
export async function signValue(value: string, secret: string): Promise<string> {
  if (value.includes(".")) {
    throw new Error("signValue(): value must not contain '.'");
  }
  const signer = makeSigner(secret);
  const sig = await signer.sign(value);
  return `${value}.${sig}`;
}

/**
 * Verify a `signValue()`-produced string. Constant-time on the signature
 * comparison.
 *
 * @param signed The `${value}.${sig}` string to verify.
 * @param secret HMAC key(s); an array lets rotated old secrets still verify.
 * @returns The original value when any secret's signature matches, else `null`.
 */
export async function verifySignedValue(
  signed: string,
  secret: string | string[]
): Promise<string | null> {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0 || dot >= signed.length - 1) return null;
  const value = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const secrets = Array.isArray(secret) ? secret : [secret];
  for (const s of secrets) {
    const signer = makeSigner(s);
    // eslint-disable-next-line no-await-in-loop
    if (await signer.verify(value, sig)) return value;
  }
  return null;
}

/** Type-augmentation helper: `interface AppState extends SessionState {}`. */
export type SessionState = { session: SessionContext };
