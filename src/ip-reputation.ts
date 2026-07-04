/**
 * IP reputation / dynamic denylist feed for {@link Hooks}. Where
 * {@link "./ip-restriction.js".ipRestriction} enforces a *static* allow/deny
 * list compiled once at construction, {@link ipReputation} wires **pluggable,
 * periodically-refreshed abuse feeds** (Tor exit lists, Spamhaus DROP,
 * cloud-abuse ranges, your own threat intel) into the request path without
 * rebuilding the matcher.
 *
 * Design goals:
 *
 * 1. **Pluggable feeds** — any {@link IpReputationFeed} that yields IP / CIDR
 *    strings. {@link urlFeed} ships for the common case (fetch a newline /
 *    Spamhaus-DROP-style list over HTTP), but a feed can be backed by anything.
 * 2. **Periodic refresh** — the denylist is reloaded on an `unref`'d timer so a
 *    long-lived abuse range eventually expires and new ranges are picked up,
 *    without a redeploy.
 * 3. **Fail-open** — a denylist is *additive* defense-in-depth, never the only
 *    gate. If a feed fails to load (initial or refresh), traffic is **not**
 *    blocked: the last-known-good list is kept (or an empty list if nothing has
 *    loaded yet). A feed outage must never take the whole app down.
 *
 * The middleware is dependency-free and runtime-portable; it reuses the
 * SSRF-grade CIDR matcher from `ipRestriction()`. {@link urlFeed}'s default
 * transport is the platform `fetch`; pass your own for non-standard runtimes or
 * to layer SSRF protection.
 *
 * @example
 * ```ts
 * import { ipReputation, urlFeed } from "@daloyjs/core";
 *
 * const reputation = ipReputation({
 *   trustProxyHeaders: true,
 *   feeds: [
 *     urlFeed("https://www.spamhaus.org/drop/drop.txt", { name: "spamhaus-drop" }),
 *     urlFeed("https://check.torproject.org/torbulkexitlist", { name: "tor-exit" }),
 *   ],
 *   refreshIntervalMs: 60 * 60_000, // hourly
 * });
 *
 * app.use(reputation.hooks);
 * // On shutdown: reputation.stop();
 * ```
 *
 * @module
 * @since 0.37.0
 */

import type { BaseContext, Hooks } from "./types.js";
import { ForbiddenError } from "./errors.js";
import { fetchGuard } from "./fetch-guard.js";
import {
  compileCidrMatcher,
  matchesMatcher,
  parseIp,
  type IpMatcher,
} from "./ip-restriction.js";

/**
 * A pluggable source of abusive IP / CIDR entries. Implementations return the
 * raw list each refresh; parsing, validation, and de-duplication are handled by
 * {@link ipReputation}.
 *
 * @since 0.37.0
 */
export interface IpReputationFeed {
  /** Human-readable feed name, surfaced in {@link IpReputationMatch.feed}. */
  name: string;
  /**
   * Fetch the current entries. May return IP addresses or CIDR ranges as
   * strings; invalid entries are skipped (never throw for junk lines). Honour
   * the {@link AbortSignal} when provided.
   *
   * @param signal - Abort signal tied to the refresh timeout.
   * @returns The current IP / CIDR entries.
   */
  fetch(signal?: AbortSignal): Promise<readonly string[]>;
}

/**
 * Details of a request that matched the reputation denylist. Passed to
 * {@link IpReputationOptions.onMatch}.
 *
 * @since 0.37.0
 */
export interface IpReputationMatch {
  /** The resolved client IP. */
  ip: string;
  /** Names of the feeds whose entries matched. */
  feeds: readonly string[];
}

/**
 * Options for {@link ipReputation}.
 *
 * @since 0.37.0
 */
export interface IpReputationOptions {
  /** One or more abuse feeds to merge into the denylist. Required, non-empty. */
  feeds: readonly IpReputationFeed[];
  /**
   * How often to reload every feed, in ms. Default 1 hour. Set `0` to disable
   * the timer and refresh only manually via {@link IpReputationController.refresh}.
   */
  refreshIntervalMs?: number;
  /**
   * Per-refresh timeout for each feed `fetch`, in ms. Default 30 s. A feed that
   * exceeds it is aborted and treated as a (fail-open) refresh failure.
   */
  fetchTimeoutMs?: number;
  /**
   * Load the feeds immediately at construction. Default `true`. When `false`,
   * the first load happens on the first timer tick (or manual `refresh()`), so
   * early requests see an empty denylist (fail-open).
   */
  loadOnStart?: boolean;
  /**
   * Custom client-IP resolver. Overrides {@link IpReputationOptions.trustProxyHeaders}.
   * Defaults to failing open (no IP → not blocked).
   */
  resolveIp?: (ctx: BaseContext<any, any>) => string | undefined;
  /**
   * Trust `X-Forwarded-For` / `X-Real-IP` in the default IP resolver. Only
   * enable behind a trusted proxy that overwrites these headers.
   */
  trustProxyHeaders?: boolean;
  /**
   * `"block"` (default) throws a {@link ForbiddenError} on a match; `"log"`
   * only invokes {@link IpReputationOptions.onMatch} and lets the request
   * continue (monitor mode).
   */
  mode?: "block" | "log";
  /** Detail string for the `403` problem+json. Default `"IP address not permitted"`. */
  message?: string;
  /** Called whenever a request IP is on the denylist (in both modes). */
  onMatch?: (match: IpReputationMatch) => void;
  /**
   * Called when a feed fails to load or refresh. The denylist keeps its
   * last-known-good entries (fail-open). Use it to surface feed-health metrics.
   */
  onError?: (error: unknown, feedName: string) => void;
}

/**
 * A running IP-reputation guard. Pass {@link IpReputationController.hooks} to
 * `app.use()`, drive refreshes manually with {@link IpReputationController.refresh},
 * and release the timer on shutdown with {@link IpReputationController.stop}.
 *
 * @since 0.37.0
 */
export interface IpReputationController {
  /** The middleware hooks to register via `app.use(...)`. */
  hooks: Hooks;
  /**
   * Force an immediate reload of every feed. Resolves once all feeds have
   * settled (failures are swallowed per the fail-open contract).
   */
  refresh(): Promise<void>;
  /** Stop the periodic-refresh timer. Idempotent. */
  stop(): void;
  /** Resolves after the first load attempt completes (success or fail-open). */
  readonly ready: Promise<void>;
  /** Current number of compiled denylist entries across all feeds. */
  readonly size: number;
  /** Test whether an IP is currently on the denylist (no side effects). */
  has(ip: string): boolean;
}

const DEFAULT_REFRESH_MS = 60 * 60_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MESSAGE = "IP address not permitted";

/**
 * Options for {@link urlFeed}.
 *
 * @since 0.37.0
 */
export interface UrlFeedOptions {
  /** Feed name. Defaults to the URL. */
  name?: string;
  /**
   * Custom `fetch` implementation. Defaults to an SSRF-hardened
   * {@link fetchGuard} instance so a compromised or malicious feed host cannot
   * redirect the request into internal/link-local space (cloud metadata, etc.).
   * Override with your own client for a non-standard runtime, or with
   * `fetchGuard({ allowPrivate: true })` for an intentionally internal feed
   * mirror.
   */
  fetchImpl?: typeof fetch;
  /** Extra request headers (e.g. an API token for a commercial feed). */
  headers?: Record<string, string>;
}

/**
 * Split a single feed line into its IP / CIDR token, stripping comments and the
 * trailing annotations common to abuse feeds (e.g. Spamhaus DROP's
 * `1.2.3.0/24 ; SBL123`). Returns `undefined` for comment-only / blank lines.
 *
 * @internal
 */
function parseFeedLine(line: string): string | undefined {
  let s = line.trim();
  if (!s || s.startsWith("#") || s.startsWith(";") || s.startsWith("//")) {
    return undefined;
  }
  // Cut inline comments / annotations after the address token.
  const cut = s.search(/[\s;#]/);
  if (cut !== -1) s = s.slice(0, cut);
  return s || undefined;
}

/**
 * Build an {@link IpReputationFeed} that fetches a newline-delimited IP / CIDR
 * list over HTTP. Handles the Spamhaus-DROP-style `<cidr> ; <annotation>`
 * format and `#` / `;` / `//` comment lines. Lines that aren't valid IPs/CIDRs
 * are skipped by {@link ipReputation}, so a partially-malformed feed still loads
 * its good entries.
 *
 * The outbound fetch is SSRF-hardened by default (see {@link UrlFeedOptions.fetchImpl}).
 *
 * @param url - The feed URL.
 * @param opts - Optional feed name, custom `fetch`, and request headers.
 * @returns A feed ready to pass to {@link IpReputationOptions.feeds}.
 * @since 0.37.0
 */
export function urlFeed(url: string, opts: UrlFeedOptions = {}): IpReputationFeed {
  const name = opts.name ?? url;
  // Secure-by-default: route the outbound feed fetch through fetchGuard() so
  // redirects are re-validated per hop and internal/metadata targets are
  // refused, matching createWebhookSender's posture. Callers can override.
  const doFetch = opts.fetchImpl ?? fetchGuard();
  return {
    name,
    async fetch(signal) {
      if (typeof doFetch !== "function") {
        throw new Error(
          "urlFeed: no fetch implementation available on this runtime. Pass options.fetchImpl.",
        );
      }
      const res = await doFetch(url, {
        signal,
        headers: opts.headers,
        redirect: "follow",
      });
      if (!res.ok) {
        throw new Error(`urlFeed: ${name} responded ${res.status}.`);
      }
      const text = await res.text();
      const out: string[] = [];
      for (const line of text.split("\n")) {
        const token = parseFeedLine(line);
        if (token !== undefined) out.push(token);
      }
      return out;
    },
  };
}

function forwardedIpResolver(ctx: BaseContext<any, any>): string | undefined {
  const headers = ctx.request.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return ctx.request.headers.get("x-real-ip") ?? undefined;
}

function noIpResolver(_ctx: BaseContext<any, any>): string | undefined {
  return undefined;
}

/** Compiled per-feed denylist, split by family for cheaper matching. */
interface CompiledFeed {
  name: string;
  v4: IpMatcher[];
  v6: IpMatcher[];
}

/**
 * IP reputation / dynamic denylist middleware. Merges one or more pluggable
 * abuse feeds into a periodically-refreshed denylist and rejects (or logs)
 * requests from listed IPs, reusing the `ipRestriction()` CIDR matcher.
 *
 * Fail-open by design: a feed that cannot be loaded never blocks traffic — the
 * last-known-good list is retained (empty until the first successful load). An
 * unresolvable client IP is also treated as not-listed.
 *
 * @param opts - Reputation configuration; `feeds` must be non-empty.
 * @returns An {@link IpReputationController} whose `hooks` go to `app.use(...)`.
 * @throws Error when `feeds` is empty, `mode` is invalid, or a numeric option
 *   is out of range.
 * @since 0.37.0
 */
export function ipReputation(opts: IpReputationOptions): IpReputationController {
  if (!opts.feeds || opts.feeds.length === 0) {
    throw new Error("ipReputation(): at least one feed must be provided.");
  }
  const mode = opts.mode ?? "block";
  if (mode !== "block" && mode !== "log") {
    throw new Error('ipReputation(): mode must be "block" or "log".');
  }
  const refreshIntervalMs = opts.refreshIntervalMs ?? DEFAULT_REFRESH_MS;
  if (!Number.isInteger(refreshIntervalMs) || refreshIntervalMs < 0) {
    throw new Error("ipReputation(): refreshIntervalMs must be a non-negative integer.");
  }
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  if (!Number.isInteger(fetchTimeoutMs) || fetchTimeoutMs <= 0) {
    throw new Error("ipReputation(): fetchTimeoutMs must be a positive integer.");
  }
  const message = opts.message ?? DEFAULT_MESSAGE;
  const resolveIp =
    opts.resolveIp ?? (opts.trustProxyHeaders ? forwardedIpResolver : noIpResolver);

  // Last-known-good compiled denylist, one entry per feed so a single feed's
  // failed refresh doesn't drop the others.
  let compiled: CompiledFeed[] = opts.feeds.map((f) => ({ name: f.name, v4: [], v6: [] }));

  const compileFeed = (name: string, entries: readonly string[]): CompiledFeed => {
    const v4: IpMatcher[] = [];
    const v6: IpMatcher[] = [];
    for (const entry of entries) {
      let matcher: IpMatcher;
      try {
        matcher = compileCidrMatcher(entry);
      } catch {
        continue; // skip junk lines; a malformed feed still loads its good rows
      }
      (matcher.family === 4 ? v4 : v6).push(matcher);
    }
    return { name, v4, v6 };
  };

  const refreshOne = async (feed: IpReputationFeed, index: number): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
    try {
      const entries = await feed.fetch(controller.signal);
      compiled[index] = compileFeed(feed.name, entries);
    } catch (err) {
      // Fail-open: keep the previous compiled entries for this feed.
      opts.onError?.(err, feed.name);
    } finally {
      clearTimeout(timer);
    }
  };

  const refresh = async (): Promise<void> => {
    await Promise.all(opts.feeds.map((feed, i) => refreshOne(feed, i)));
  };

  const matchingFeeds = (ip: string): string[] => {
    const parsed = parseIp(ip);
    if (!parsed) return [];
    const hits: string[] = [];
    for (const feed of compiled) {
      const list = parsed.family === 4 ? feed.v4 : feed.v6;
      if (list.some((m) => matchesMatcher(parsed, m))) hits.push(feed.name);
    }
    return hits;
  };

  let stopped = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  if (refreshIntervalMs > 0) {
    interval = setInterval(() => {
      void refresh();
    }, refreshIntervalMs);
    if (typeof interval === "object" && typeof interval.unref === "function") {
      interval.unref();
    }
  }

  const ready =
    opts.loadOnStart === false ? Promise.resolve() : refresh();

  return {
    hooks: {
      beforeHandle(ctx) {
        const ip = resolveIp(ctx);
        if (!ip) return undefined; // fail-open on unresolved IP
        const feeds = matchingFeeds(ip);
        if (feeds.length === 0) return undefined;
        opts.onMatch?.({ ip, feeds });
        if (mode === "block") throw new ForbiddenError(message);
        return undefined;
      },
    },
    refresh,
    stop() {
      if (stopped) return;
      stopped = true;
      if (interval !== undefined) clearInterval(interval);
    },
    get ready() {
      return ready;
    },
    get size() {
      let total = 0;
      for (const feed of compiled) total += feed.v4.length + feed.v6.length;
      return total;
    },
    has(ip: string) {
      return matchingFeeds(ip).length > 0;
    },
  };
}
