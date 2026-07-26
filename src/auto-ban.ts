/**
 * Adaptive auto-ban (fail2ban-style) middleware. Where {@link "./middleware.js".loginThrottle}
 * only protects credential-entry routes, {@link autoBan} generalizes the idea
 * into a reusable, escalating, decaying ban primitive: when a single client
 * trips too many "suspicious" responses (by default `401` / `403` / `429`) inside
 * a rolling window, it is temporarily banned. Repeat offenders earn
 * exponentially longer bans, and the record decays away once the client goes
 * quiet — so a one-off burst is forgiven while a persistent attacker is shut out
 * for progressively longer.
 *
 * The middleware is dependency-free and runtime-portable. It observes outgoing
 * responses via the {@link "./types.js".Hooks.onSend} hook (so it counts the
 * status produced by *any* later middleware or handler, not just its own) and
 * enforces the ban in {@link "./types.js".Hooks.beforeHandle}. The ban state
 * lives in a pluggable {@link AutoBanStore} — the in-memory default mirrors the
 * `rateLimit()` store and is single-process only; supply a shared (e.g. Redis)
 * implementation for multi-instance deployments.
 *
 * @module
 * @since 0.37.0
 */

import type { BaseContext, Hooks } from "./types.js";
import { ForbiddenError, TooManyRequestsError } from "./errors.js";

/**
 * One client's auto-ban bookkeeping. A record tracks the current strike count
 * inside the rolling strike window, when that window expires, the timestamp the
 * client is banned until (`0` when not banned), and how many bans the client
 * has accumulated while the record has stayed alive (drives escalation).
 *
 * @since 0.37.0
 */
export interface AutoBanRecord {
  /** Suspicious responses seen inside the current strike window. */
  strikes: number;
  /** Epoch ms at which the current strike window resets (strikes decay to 0). */
  strikeExpiresMs: number;
  /** Epoch ms the client is banned until; `0` when the client is not banned. */
  bannedUntilMs: number;
  /** Total bans issued while this record stayed alive; drives escalation. */
  banCount: number;
}

/**
 * Pluggable backend for {@link autoBan}, mirroring the `rateLimit()` store
 * contract. Implementations persist one {@link AutoBanRecord} per key and must
 * treat an entry whose `ttlMs` has elapsed as absent (so bans and escalation
 * decay automatically). The built-in default is in-memory and single-process;
 * back it with Redis (or another shared store) for multi-instance deployments.
 *
 * @since 0.37.0
 */
export interface AutoBanStore {
  /** Resolve the current record for `key`, or `undefined` when none/expired. */
  get(key: string): Promise<AutoBanRecord | undefined>;
  /**
   * Persist `record` for `key`, expiring it after `ttlMs`. Implementations
   * should set the backing TTL so an idle key is reclaimed automatically.
   */
  set(key: string, record: AutoBanRecord, ttlMs: number): Promise<void>;
  /** Forget `key` entirely (e.g. an operator manually lifting a ban). */
  delete(key: string): Promise<void>;
}

/**
 * Emitted via {@link AutoBanOptions.onBan} when a client crosses the strike
 * threshold and a (possibly escalated) ban is issued. Useful for alerting,
 * structured audit logging, or feeding an external denylist.
 *
 * @since 0.37.0
 */
export interface AutoBanEvent {
  /** The store key the ban applies to (group prefix + client identity). */
  key: string;
  /** How many times this client has been banned while its record stayed alive. */
  banCount: number;
  /** The duration of this ban in milliseconds. */
  banDurationMs: number;
  /** Epoch ms the client is banned until. */
  bannedUntilMs: number;
}

/**
 * Emitted via {@link AutoBanOptions.onStrike} every time a suspicious response
 * is attributed to a client (before any resulting ban). Lets callers observe
 * pressure building without waiting for the ban itself.
 *
 * @since 0.37.0
 */
export interface AutoBanStrikeEvent {
  /** The store key the strike applies to. */
  key: string;
  /** The strike count after recording this strike, inside the current window. */
  strikes: number;
  /** The response status that triggered the strike. */
  status: number;
}

/**
 * Configuration for {@link autoBan}. Every field is optional except that the
 * middleware must be able to identify clients: supply a {@link keyGenerator} or
 * set {@link trustProxyHeaders} (otherwise construction throws, to avoid
 * accidentally banning every client through a shared `"global"` bucket).
 *
 * @since 0.37.0
 */
export interface AutoBanOptions {
  /** Rolling strike window in ms; strikes older than this decay. Default: 10 minutes. */
  windowMs?: number;
  /** Suspicious responses inside `windowMs` that trigger a ban. Default: 5. */
  maxStrikes?: number;
  /** Base ban duration in ms (first offence). Default: 15 minutes. */
  banMs?: number;
  /** Hard cap on an escalated ban duration in ms. Default: 24 hours. */
  maxBanMs?: number;
  /**
   * Double the ban duration on each repeat ban while the record stays alive
   * (`banMs`, `2×banMs`, `4×banMs`, … capped at `maxBanMs`). Default: `true`.
   * When `false`, every ban lasts exactly `banMs`.
   */
  escalate?: boolean;
  /**
   * Response status codes treated as suspicious. Default: `[401, 403, 429]`.
   * Add `400` / `422` to also count request-validation failures, but be aware
   * those can include honest client mistakes.
   */
  watchStatuses?: readonly number[];
  /**
   * Status used for the ban rejection: `429` (default, carries `Retry-After`)
   * or `403`. `403` surfaces {@link AutoBanOptions.message}.
   */
  banStatus?: 403 | 429;
  /**
   * Derive the client identity from `ctx`, or `undefined` to skip the request
   * (fail-open — never banned, never counted). Defaults to the proxy-header
   * resolver when {@link trustProxyHeaders} is set.
   */
  keyGenerator?: (ctx: BaseContext<any, any>) => string | undefined;
  /**
   * Read `X-Forwarded-For` / `X-Real-IP` in the default key generator. Off by
   * default because those headers are client-spoofable unless every request
   * reaches the app through a proxy chain you control.
   */
  trustProxyHeaders?: boolean;
  /** Pluggable ban store. Default: a shared in-memory store keyed by `groupId`. */
  store?: AutoBanStore;
  /**
   * Share one ban store across every `autoBan()` mounted with the same
   * `groupId`, so a client banned on one route group is banned on all of them.
   * Default: `"auto-ban"`. Only meaningful for the in-memory default store.
   */
  groupId?: string;
  /** Send `Retry-After` on a `429` ban rejection. Default: `true`. */
  retryAfter?: boolean;
  /** Message for the `403` ban variant. Default: `"Temporarily banned"`. */
  message?: string;
  /** Called when a ban is issued (alerting / audit / external denylist). */
  onBan?: (event: AutoBanEvent) => void;
  /** Called for every recorded strike, before any resulting ban. */
  onStrike?: (event: AutoBanStrikeEvent) => void;
}

const DEFAULT_WINDOW_MS = 10 * 60_000;
const DEFAULT_MAX_STRIKES = 5;
const DEFAULT_BAN_MS = 15 * 60_000;
const DEFAULT_MAX_BAN_MS = 24 * 60 * 60_000;
const DEFAULT_WATCH_STATUSES: readonly number[] = [401, 403, 429];
const DEFAULT_GROUP_ID = "auto-ban";

const STATE_KEY = "__autoBanKey";
const STATE_REJECTED = "__autoBanRejected";

/**
 * Process-wide registry of shared in-memory stores keyed by `groupId`, so two
 * `autoBan({ groupId })` mounts cooperate on one ban map.
 *
 * @internal
 */
const SHARED_AUTO_BAN_STORES = new Map<string, MemoryAutoBanStore>();

/**
 * Test-only helper that clears the process-wide shared auto-ban stores. Not part
 * of the documented public API.
 *
 * @internal
 */
export function _resetAutoBanStoresForTests(): void {
  SHARED_AUTO_BAN_STORES.clear();
}

/**
 * Default in-memory {@link AutoBanStore}. Single-process only; entries are
 * reclaimed lazily on access and opportunistically when the map grows large, so
 * an idle attacker's record decays without an explicit timer.
 *
 * @since 0.37.0
 */
export class MemoryAutoBanStore implements AutoBanStore {
  private map = new Map<string, { record: AutoBanRecord; expiresMs: number }>();

  /** {@inheritDoc AutoBanStore.get} */
  async get(key: string): Promise<AutoBanRecord | undefined> {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresMs <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.record;
  }

  /** {@inheritDoc AutoBanStore.set} */
  async set(key: string, record: AutoBanRecord, ttlMs: number): Promise<void> {
    const now = Date.now();
    this.map.set(key, { record, expiresMs: now + ttlMs });
    if (this.map.size > 10_000) {
      for (const [k, v] of this.map) if (v.expiresMs <= now) this.map.delete(k);
    }
  }

  /** {@inheritDoc AutoBanStore.delete} */
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`autoBan(): ${name} must be a positive integer.`);
  }
}

function forwardedKey(ctx: BaseContext<any, any>): string | undefined {
  const forwarded = ctx.request.headers.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0]!.trim() : "";
  if (first) return first;
  return ctx.request.headers.get("x-real-ip") ?? undefined;
}

/**
 * Adaptive, escalating, decaying auto-ban middleware (fail2ban-style). Counts
 * suspicious outgoing responses per client and temporarily bans repeat
 * offenders; bans grow exponentially for persistent abuse and decay once the
 * client goes quiet.
 *
 * Identity attribution is mandatory: pass {@link AutoBanOptions.keyGenerator} or
 * set {@link AutoBanOptions.trustProxyHeaders}, otherwise construction throws so
 * a misconfiguration can never collapse every caller into one shared bucket and
 * ban the whole world at once. A request the key generator cannot attribute is
 * skipped (never counted, never banned).
 *
 * @example
 * ```ts
 * import { autoBan } from "@daloyjs/core";
 *
 * // Five 401/403/429s within 10 min → 15 min ban, doubling for repeat offenders.
 * app.use(autoBan({ trustProxyHeaders: true }));
 * ```
 *
 * @param opts - Auto-ban configuration.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @throws Error when neither `keyGenerator` nor `trustProxyHeaders` is provided,
 *   or when a numeric option is out of range.
 * @since 0.37.0
 */
export function autoBan(opts: AutoBanOptions = {}): Hooks {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const maxStrikes = opts.maxStrikes ?? DEFAULT_MAX_STRIKES;
  const banMs = opts.banMs ?? DEFAULT_BAN_MS;
  const maxBanMs = opts.maxBanMs ?? DEFAULT_MAX_BAN_MS;
  assertPositiveInteger("windowMs", windowMs);
  assertPositiveInteger("maxStrikes", maxStrikes);
  assertPositiveInteger("banMs", banMs);
  assertPositiveInteger("maxBanMs", maxBanMs);
  if (maxBanMs < banMs) {
    throw new Error("autoBan(): maxBanMs must be >= banMs.");
  }

  const escalate = opts.escalate ?? true;
  const banStatus = opts.banStatus ?? 429;
  if (banStatus !== 403 && banStatus !== 429) {
    throw new Error("autoBan(): banStatus must be 403 or 429.");
  }
  const retryAfter = opts.retryAfter !== false;
  const message = opts.message ?? "Temporarily banned";

  const watchStatuses = opts.watchStatuses ?? DEFAULT_WATCH_STATUSES;
  if (watchStatuses.length === 0) {
    throw new Error("autoBan(): watchStatuses must list at least one status code.");
  }
  for (const status of watchStatuses) {
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new Error("autoBan(): watchStatuses must be integer HTTP status codes (100-599).");
    }
  }
  const watch = new Set<number>(watchStatuses);

  if (!opts.keyGenerator && !opts.trustProxyHeaders) {
    throw new Error(
      "autoBan(): provide keyGenerator or set trustProxyHeaders so clients can be identified; " +
        "otherwise every caller shares one bucket and a single offender would ban everyone."
    );
  }
  const keyOf = opts.keyGenerator ?? forwardedKey;

  const groupId = opts.groupId ?? DEFAULT_GROUP_ID;
  let store: AutoBanStore;
  if (opts.store) {
    store = opts.store;
  } else {
    let shared = SHARED_AUTO_BAN_STORES.get(groupId);
    if (!shared) {
      shared = new MemoryAutoBanStore();
      SHARED_AUTO_BAN_STORES.set(groupId, shared);
    }
    store = shared;
  }
  const prefix = `${groupId}:`;

  return {
    async beforeHandle(ctx) {
      const identity = keyOf(ctx);
      if (identity === undefined) return undefined;
      const key = `${prefix}${identity}`;
      const state = ctx.state as Record<string, unknown>;
      state[STATE_KEY] = key;
      const record = await store.get(key);
      const now = Date.now();
      if (record && record.bannedUntilMs > now) {
        state[STATE_REJECTED] = true;
        if (banStatus === 403) throw new ForbiddenError(message);
        const retry = Math.ceil((record.bannedUntilMs - now) / 1000);
        throw new TooManyRequestsError(retryAfter ? retry : undefined);
      }
      return undefined;
    },

    async onSend(res, ctx) {
      if (!ctx) return undefined;
      const state = ctx.state as Record<string, unknown>;
      // Never count the ban rejection we just produced — that would let an
      // active ban perpetually re-arm itself.
      if (state[STATE_REJECTED] === true) return undefined;
      const key = state[STATE_KEY] as string | undefined;
      if (key === undefined) return undefined;
      if (!watch.has(res.status)) return undefined;

      const now = Date.now();
      const record = await store.get(key);
      const windowActive = record !== undefined && record.strikeExpiresMs > now;
      let strikes = (windowActive ? record!.strikes : 0) + 1;
      let banCount = record?.banCount ?? 0;
      let bannedUntilMs = record?.bannedUntilMs ?? 0;
      const strikeExpiresMs = now + windowMs;

      opts.onStrike?.({ key, strikes, status: res.status });

      if (strikes >= maxStrikes) {
        banCount += 1;
        const duration = escalate ? Math.min(maxBanMs, banMs * 2 ** (banCount - 1)) : banMs;
        bannedUntilMs = now + duration;
        strikes = 0;
        opts.onBan?.({ key, banCount, banDurationMs: duration, bannedUntilMs });
      }

      const ttlMs = Math.max(strikeExpiresMs, bannedUntilMs) - now;
      await store.set(key, { strikes, strikeExpiresMs, bannedUntilMs, banCount }, ttlMs);
      return undefined;
    },
  };
}
