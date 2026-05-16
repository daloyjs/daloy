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
 * works on Node, Bun, Deno, Cloudflare Workers, and Vercel Edge.
 */

import type { Hooks } from "./types.js";
import { timingSafeEqual } from "./security.js";

const DEFAULT_COOKIE_NAME = "__Host-daloy.sid";

// ---------- Public types ----------

export interface SessionRecord {
  /** Arbitrary serializable session payload. Mutating this object marks the session dirty. */
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
  get(sid: string): SessionRecord | null | Promise<SessionRecord | null>;
  set(sid: string, record: SessionRecord): void | Promise<void>;
  destroy(sid: string): void | Promise<void>;
  /** Optional fast-path for rolling sessions; falls back to `set()` if omitted. */
  touch?(sid: string, expiresAt: number): void | Promise<void>;
}

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
  /** Session payload. Mutating this object marks the session dirty. */
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
}; const STATE_KEY = "session"; const STATE_INTERNAL = "__sessionInternal";
// ---------- Implementation ----------
const COOKIE_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

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
      "session(): Web Crypto (crypto.subtle) is required. Provide a polyfill in environments without it.",
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
    throw new Error("session(): each secret must be a string of at least 16 characters.");
  }
  let keyPromise: Promise<CryptoKey> | null = null;
  const getKey = () => {
    if (!keyPromise) {
      keyPromise = getSubtle().importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
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
    throw new Error("session(): Web Crypto getRandomValues is required for the default id generator.");
  }
  const buf = new Uint8Array(32);
  c.getRandomValues(buf);
  return bytesToBase64Url(buf);
}

function validateCookieSegment(kind: "path" | "domain", value: string): void {
  if (/[;\r\n\0]/.test(value)) throw new Error(`session(): cookieOptions.${kind} contains an invalid character.`);
}

function validateCookieOptions(cookieName: string, opts: Required<SessionCookieOptions>): void {
  if (!COOKIE_NAME_RE.test(cookieName)) throw new Error("session(): cookieName is not a valid cookie name.");
  if (opts.sameSite !== "Strict" && opts.sameSite !== "Lax" && opts.sameSite !== "None") {
    throw new Error('session(): cookieOptions.sameSite must be "Strict", "Lax", or "None".');
  }
  if (!opts.path.startsWith("/")) throw new Error('session(): cookieOptions.path must start with "/".');
  validateCookieSegment("path", opts.path);
  if (opts.domain) validateCookieSegment("domain", opts.domain);
  if (!Number.isInteger(opts.maxAgeSeconds) || opts.maxAgeSeconds < 0) {
    throw new Error("session(): cookieOptions.maxAgeSeconds must be a non-negative integer.");
  }
  if (cookieName.startsWith("__Host-")) {
    if (!opts.secure || opts.path !== "/" || opts.domain) {
      throw new Error(
        'session(): "__Host-" cookie names require secure: true, path: "/", and no domain. ' +
          "Pass an explicit cookieName or relax cookieOptions to use a non-prefixed cookie.",
      );
    }
  }
  if (opts.sameSite === "None" && !opts.secure) {
    throw new Error('session(): cookieOptions.sameSite: "None" requires secure: true.');
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) {
      const v = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

function buildSetCookie(name: string, value: string, opts: Required<SessionCookieOptions>): string {
  let s = `${name}=${encodeURIComponent(value)}`;
  s += `; Path=${opts.path}`;
  s += `; SameSite=${opts.sameSite}`;
  if (opts.secure) s += "; Secure";
  if (opts.httpOnly) s += "; HttpOnly";
  if (opts.domain) s += `; Domain=${opts.domain}`;
  if (opts.maxAgeSeconds > 0) s += `; Max-Age=${opts.maxAgeSeconds}`;
  if (opts.partitioned) s += "; Partitioned";
  return s;
}

function buildClearCookie(name: string, opts: Required<SessionCookieOptions>): string {
  let s = `${name}=`;
  s += `; Path=${opts.path}`;
  s += `; SameSite=${opts.sameSite}`;
  if (opts.secure) s += "; Secure";
  if (opts.httpOnly) s += "; HttpOnly";
  if (opts.domain) s += `; Domain=${opts.domain}`;
  s += "; Max-Age=0";
  if (opts.partitioned) s += "; Partitioned";
  return s;
}

function markDirty(internal: SessionInternal): void {
  internal.dirty = true;
}

function makeSessionContext(
  id: string,
  data: Record<string, unknown>,
  internal: SessionInternal,
  regenerate: (keepData: boolean) => Promise<string>,
): SessionContext {
  const proxy = new Proxy(data, {
    set(target, key, value) {
      target[key as string] = value;
      markDirty(internal);
      return true;
    },
    deleteProperty(target, key) {
      const had = key in target;
      delete target[key as string];
      if (had) markDirty(internal);
      return true;
    },
  });
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

  get(sid: string): SessionRecord | null {
    const rec = this.map.get(sid);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      this.map.delete(sid);
      return null;
    }
    return rec;
  }

  set(sid: string, record: SessionRecord): void {
    this.map.set(sid, record);
  }

  destroy(sid: string): void {
    this.map.delete(sid);
  }

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
  validateCookieOptions(cookieName, cookieOpts);

  const ttlSeconds = opts.ttlSeconds ?? 86_400;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("session(): ttlSeconds must be a positive integer.");
  }
  const ttlMs = ttlSeconds * 1000;
  const rolling = opts.rolling !== false;
  const store = opts.store ?? new MemorySessionStore();
  const generator = opts.generator ?? generateSessionId;
  const saveUninitialized = opts.saveUninitialized === true;

  return {
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
      };

      const raw = readCookie(ctx.request.headers.get("cookie"), cookieName);
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
                data = rec.data ? { ...rec.data } : {};
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
        if (internal.activeId && internal.originalId === internal.activeId) {
          await store.destroy(internal.activeId);
        } else if (internal.activeId && internal.activeId !== internal.originalId) {
          // We rotated mid-request previously; throw away the unsaved id.
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
          res.headers.append("set-cookie", buildClearCookie(internal.cookieName, internal.cookieOpts));
        }
        return undefined;
      }

      const sessionCtx = state[STATE_KEY] as SessionContext;
      const data = sessionCtx.data;
      const sid = internal.activeId!;
      const expiresAt = Date.now() + internal.ttlMs;

      // A brand-new, untouched session is a no-op unless saveUninitialized is on.
      const initialized = internal.dirty || internal.regenerated || internal.originalId !== null;
      if (!initialized && !internal.saveUninitialized) return undefined;

      const mustPersist = internal.dirty || internal.created || internal.regenerated;

      if (mustPersist) {
        await store.set(sid, { data: { ...data }, expiresAt });
      } else if (internal.rolling) {
        if (store.touch) await store.touch(sid, expiresAt);
        else await store.set(sid, { data: { ...data }, expiresAt });
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
        buildSetCookie(internal.cookieName, `${sid}.${sig}`, internal.cookieOpts),
      );
      return undefined;
    },
  };
}

// ---------- Low-level signing helpers (re-exported for advanced use) ----------

/**
 * Sign an arbitrary string with HMAC-SHA256. Returns `${value}.${sig}` where
 * `sig` is URL-safe base64. Useful for building custom signed cookies or
 * tokens that do not need a session store.
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
 * Verify a `signValue()`-produced string. Returns the original value when the
 * signature checks out, otherwise `null`. Constant-time on the signature.
 */
export async function verifySignedValue(signed: string, secret: string | string[]): Promise<string | null> {
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

// Re-export for downstream type augmentation.
export type SessionState = { session: SessionContext };
