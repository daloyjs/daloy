/**
 * PSL-aware `subdomains()` helper.
 *
 * Splits a hostname into its registrable base + the subdomain labels above
 * it, using a bundled Public Suffix List snapshot. The helper refuses to
 * read a stale PSL snapshot (`> 90 days` since `PSL_SNAPSHOT_DATE`) in
 * production so adjacent-tenant infrastructure names like `*.s3.amazonaws.com`,
 * `*.github.io`, `*.vercel.app`, `*.workers.dev`, and every
 * preview-deploy environment are split correctly instead of being treated
 * as siblings under the same registrable domain.
 *
 * @since 0.24.0
 */

/**
 * ISO date the bundled PSL snapshot was generated. Refresh this value when
 * you re-snapshot {@link PSL_PUBLIC_SUFFIXES} from the upstream Public
 * Suffix List at https://publicsuffix.org/list/public_suffix_list.dat
 *
 * @since 0.24.0
 */
export const PSL_SNAPSHOT_DATE = "2026-05-20";

/**
 * Bundled subset of the Public Suffix List. Hand-picked entries covering
 * the common cases Daloy users hit (cloud preview deployments, shared
 * hosting platforms, country-code second-level domains). Augment with
 * `subdomains({ extraSuffixes: [...] })` for project-specific TLDs.
 *
 * @since 0.24.0
 */
export const PSL_PUBLIC_SUFFIXES: readonly string[] = [
  // Generic TLDs
  "com",
  "net",
  "org",
  "io",
  "dev",
  "app",
  "ai",
  "co",
  // Country-code TLDs that frequently host commerce subdomains.
  "uk",
  "co.uk",
  "ac.uk",
  "gov.uk",
  "jp",
  "co.jp",
  "ne.jp",
  "ac.jp",
  "au",
  "com.au",
  "net.au",
  "ph",
  "com.ph",
  "no",
  "de",
  "fr",
  "ca",
  // PaaS / preview-deploy registrable suffixes — every entry below is a
  // "subdomain isolates a tenant" surface where treating the suffix as a
  // single registrable domain would name an adjacent tenant.
  "vercel.app",
  "netlify.app",
  "netlify.com",
  "workers.dev",
  "pages.dev",
  "fly.dev",
  "github.io",
  "githubusercontent.com",
  "gitlab.io",
  "herokuapp.com",
  "azurewebsites.net",
  "s3.amazonaws.com",
  "cloudfront.net",
  "appspot.com",
  "firebaseapp.com",
  "web.app",
  "supabase.co",
  "render.com",
  "onrender.com",
];

/**
 * Options for {@link subdomains}.
 *
 * @since 0.24.0
 */
export interface SubdomainsOptions {
  /**
   * Explicit registrable base domain. When supplied, the PSL match is
   * skipped and any suffix that is not exactly this base raises a runtime
   * error. Strongly recommended in production.
   */
  baseDomain?: string;
  /**
   * Additional public-suffix entries beyond {@link PSL_PUBLIC_SUFFIXES}.
   * Use for company-specific shared-hosting registrable suffixes.
   */
  extraSuffixes?: readonly string[];
  /**
   * Whether the app is running in production. When `true` and the bundled
   * snapshot is older than {@link MAX_SNAPSHOT_AGE_DAYS}, the helper
   * throws on first call so deploys cannot ship with a stale PSL.
   * Defaults to `false`.
   */
  production?: boolean;
  /**
   * Override the snapshot date used for the staleness check. Test-only.
   * @internal
   */
  _snapshotDate?: string;
  /**
   * Override "now" for the staleness check. Test-only.
   * @internal
   */
  _now?: Date;
}

/** Maximum age, in days, before startup fails because the bundled Public Suffix List snapshot is stale. */
export const MAX_SNAPSHOT_AGE_DAYS = 90;

/**
 * Decomposed hostname. `subdomain` is the dotted-label prefix above the
 * registrable base (`""` when the host equals the base exactly).
 *
 * @since 0.24.0
 */
export interface SubdomainsResult {
  /** Registrable base domain (e.g. `example.co.uk`, `tenant.vercel.app`). */
  baseDomain: string;
  /** Labels above the base, joined by `.`. Empty when no labels are above. */
  subdomain: string;
  /** Labels above the base as an array, ordered from leftmost to rightmost. */
  labels: readonly string[];
}

/**
 * Split a hostname into registrable base + subdomain labels using the
 * bundled PSL snapshot. Refuses to read a stale snapshot in production.
 *
 * @example
 * ```ts
 * subdomains("api.tenant.example.co.uk")
 * // => { baseDomain: "example.co.uk", subdomain: "api.tenant", labels: ["api", "tenant"] }
 *
 * subdomains("foo.bar.s3.amazonaws.com")
 * // => { baseDomain: "bar.s3.amazonaws.com", subdomain: "foo", labels: ["foo"] }
 * ```
 *
 * @param hostname - Hostname to split (lowercased; a trailing FQDN dot is stripped).
 * @param opts - Optional pinned `baseDomain`, `extraSuffixes`, and the `production` staleness gate.
 * @returns The registrable {@link SubdomainsResult} (`baseDomain`, `subdomain`, `labels`).
 * @throws {Error} On an empty hostname, a host outside a declared `baseDomain`, or a stale PSL snapshot in production.
 * @since 0.24.0
 */
export function subdomains(
  hostname: string,
  opts: SubdomainsOptions = {},
): SubdomainsResult {
  if (typeof hostname !== "string" || hostname.length === 0) {
    throw new Error("subdomains(): hostname must be a non-empty string.");
  }
  // Strip a trailing dot (FQDN form) and lowercase for the PSL match.
  const host = hostname.replace(/\.$/, "").toLowerCase();

  // Production-mode staleness check.
  if (opts.production) {
    const snap = opts._snapshotDate ?? PSL_SNAPSHOT_DATE;
    const now = opts._now ?? new Date();
    const snapMs = Date.parse(snap);
    if (Number.isNaN(snapMs)) {
      throw new Error(`subdomains(): invalid snapshot date ${JSON.stringify(snap)}.`);
    }
    const ageDays = (now.getTime() - snapMs) / 86_400_000;
    if (ageDays > MAX_SNAPSHOT_AGE_DAYS) {
      throw new Error(
        `subdomains(): bundled Public Suffix List snapshot is ${Math.round(ageDays)} days old ` +
          `(threshold ${MAX_SNAPSHOT_AGE_DAYS} days). Refresh PSL_PUBLIC_SUFFIXES or upgrade @daloyjs/core.`,
      );
    }
  }

  if (opts.baseDomain) {
    const base = opts.baseDomain.toLowerCase();
    if (host !== base && !host.endsWith(`.${base}`)) {
      throw new Error(
        `subdomains(): host ${JSON.stringify(hostname)} is not under declared baseDomain ${JSON.stringify(opts.baseDomain)}.`,
      );
    }
    return resultFor(host, base);
  }

  const suffixes = new Set<string>([
    ...PSL_PUBLIC_SUFFIXES,
    ...(opts.extraSuffixes ?? []),
  ]);

  const labels = host.split(".");
  // Walk from the longest suffix candidate down to the shortest so the
  // longest match wins (`s3.amazonaws.com` beats `com`).
  let bestSuffixLabels = 0;
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join(".");
    if (suffixes.has(candidate)) {
      const suffixLabelCount = labels.length - i;
      if (suffixLabelCount > bestSuffixLabels) bestSuffixLabels = suffixLabelCount;
    }
  }
  // No PSL match — treat the rightmost label as the public suffix
  // (single-label TLD fallback).
  if (bestSuffixLabels === 0) bestSuffixLabels = 1;

  // Registrable base = public suffix + one label to the left.
  const baseLabelCount = Math.min(labels.length, bestSuffixLabels + 1);
  const baseDomain = labels.slice(labels.length - baseLabelCount).join(".");
  return resultFor(host, baseDomain);
}

function resultFor(host: string, baseDomain: string): SubdomainsResult {
  if (host === baseDomain) {
    return { baseDomain, subdomain: "", labels: [] };
  }
  const prefix = host.slice(0, host.length - baseDomain.length - 1);
  const labels = prefix.split(".");
  return { baseDomain, subdomain: prefix, labels };
}
