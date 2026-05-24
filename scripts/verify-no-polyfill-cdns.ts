/**
 * Hijacked-CDN host CI gate (Aikido / Sansec polyfill.io class).
 *
 * Aikido's 2024-06-27 write-up
 * (https://www.aikido.dev/blog/polyfill-io-supply-chain-attack-what-do-you-need-to-do)
 * and Sansec's parallel investigation
 * (https://sansec.io/research/polyfill-supply-chain-attack)
 * document the **polyfill.io** supply-chain attack: in February 2024 the
 * Chinese CDN operator **Funnull** acquired the `polyfill.io` domain and
 * the matching GitHub repository, then began serving conditional malware
 * from `cdn.polyfill.io` to roughly **110 000 sites** that had embedded
 * the classic `<script src="https://cdn.polyfill.io/v3/polyfill.min.js">`
 * tag. The injected payload only fired against mobile traffic, only on
 * the first request from a given device, and only when the referring
 * page was not an admin / analytics console — so it evaded developer
 * QA while redirecting real users to fake sports-betting and adult
 * sites. Cloudflare, Fastly, and Google all reacted by either taking
 * down ad placements referencing the domain or by setting up safe
 * mirrors. The original `polyfill.io` domain remains under Funnull's
 * control and MUST be treated as compromised.
 *
 * Sansec's follow-up reporting and Silent Push's domain-clustering
 * analysis tied Funnull to a constellation of additional hijacked /
 * Funnull-operated CDN hosts that have also served live malware in the
 * same campaign and its follow-ons:
 *
 *   - `bootcss.com`, `bootcdn.net` — historically used as `<script>`
 *     sources by Chinese front-end tutorials; both have been observed
 *     under the same operator and have served browser-targeted
 *     payloads.
 *   - `staticfile.org`, `staticfile.net` — same operator pattern.
 *   - `polyfill.com`, `polyfillcache.com`, `polyfill-cdn.com` — squats
 *     and aliases registered around the original takedown event.
 *   - `unionadjs.com`, `xhsbpza.com` — Funnull-cluster C2 / ad-fraud
 *     hosts named in Sansec's IOC list.
 *
 * Any `<script>` / `<link>` / `<img>` / `fetch()` / `import()` reference
 * to one of those hosts inside this repository — runtime source,
 * scaffolded templates, documentation site, blog posts, examples — is
 * a **hard IOC** of the polyfill class. The user-facing damage is the
 * same as a malicious npm republish (a hijacked CDN reaches every
 * visitor that loads the page), but the supply-chain primitives this
 * repository's existing `verify:no-remote-exec` /
 * `verify:no-registry-exfiltration` gates protect against do NOT see
 * an HTML `<script src="https://...">` literal in a Markdown blog post
 * or in a scaffolded HTML template. This gate closes that gap.
 *
 * Scope (broader than `src/**` on purpose):
 *
 *   - `src/**`           — framework runtime source.
 *   - `examples/**`      — example apps users copy from.
 *   - `bench/**`         — benchmark fixtures.
 *   - `bin/**`           — published CLI entry points.
 *   - `packages/**`      — `create-daloy` and its templates (the
 *                          scaffolded HTML / package.json snippets
 *                          users get on `pnpm create daloy`).
 *   - `website/**`       — the marketing/docs site (`app/**`,
 *                          `components/**`, blog posts in MDX/TSX).
 *   - `my-app/**`        — local scaffold output checked in for
 *                          contributor smoke tests.
 *   - Top-level docs     — `README.md`, `CONTRIBUTING.md`, etc.
 *
 * Skipped by design:
 *
 *   - `.git/`, `node_modules/`, `dist/`, `dist-coverage/`, `coverage/`,
 *     `temp_tarball/`, `generated/`, `.next/`, `out/`, `build/`,
 *     `.turbo/`, `.cache/`, `.vercel/`, `.pnpm-store/` — generated /
 *     vendored output, not source under our control.
 *   - `tests/**`           — tests for this very gate must be able to
 *                            mention the IOC strings; mirrors the
 *                            convention used by
 *                            `verify-no-registry-exfiltration` and
 *                            `verify-no-remote-exec`.
 *   - `otherdocs/**`       — internal security-research notes that
 *                            cite the campaign by name.
 *   - `SECURITY.md`,
 *     `PROJECT_HISTORY.md`,
 *     `ROADMAP.md`,
 *     `CODE_REVIEW.md`     — security-disclosure / release-notes
 *                            documentation that names the campaign by
 *                            host.
 *   - `scripts/verify-no-polyfill-cdns.ts` (this file) and its
 *     compiled `.js` twin — must be able to name the IOCs it gates on.
 *   - `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` — lockfile
 *     entries are tracked by `verify:lockfile-sources` and would
 *     mostly be `cdn.example.com` test fixtures here.
 *
 * Exit code:
 *   0 — no hijacked-CDN host references found in the scanned tree.
 *   1 — at least one was found; offending lines printed to stderr with
 *       the IOC host name and the campaign citation.
 *
 * @since 0.34.4
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative, sep } from "node:path";

const REPO_ROOT = new URL("../", import.meta.url);

export interface ForbiddenCdnReference {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly host: string;
  readonly reason: string;
}

interface ForbiddenHost {
  /** The hostname token. Matched case-insensitively as a whole DNS label
   *  sequence so substrings inside an unrelated longer name don't trip. */
  readonly host: string;
  /** Short human-readable citation appended to every finding. */
  readonly reason: string;
}

/**
 * Hosts that MUST NOT appear anywhere in the scanned tree. The set is
 * deliberately conservative: every entry has documented public reporting
 * of either (a) live malware served from the host, or (b) operation by
 * the same Funnull cluster that hijacked `polyfill.io`.
 */
const FORBIDDEN_HOSTS: readonly ForbiddenHost[] = [
  {
    host: "cdn.polyfill.io",
    reason:
      "`cdn.polyfill.io` was hijacked in February 2024 by Funnull and served conditional malware " +
      "to ~110 000 sites until the domain was sinkholed (Aikido 2024-06-27, Sansec 2024-06-25); " +
      "use Cloudflare's mirror at `cdnjs.cloudflare.com/polyfill/` or self-host the polyfill bundle.",
  },
  {
    host: "polyfill.io",
    reason:
      "the bare `polyfill.io` apex domain remains under Funnull control after the June 2024 " +
      "supply-chain compromise (Aikido, Sansec); ANY `<script>` / `fetch()` / `import()` reference " +
      "is a hard IOC — switch to `cdnjs.cloudflare.com/polyfill/` or a self-hosted bundle.",
  },
  {
    host: "polyfill.com",
    reason:
      "`polyfill.com` was registered by Funnull alongside the `polyfill.io` takeover and is part " +
      "of the same hijacked-CDN cluster (Sansec); never reference it from a `<script>` tag.",
  },
  {
    host: "polyfillcache.com",
    reason:
      "`polyfillcache.com` is a documented Funnull-cluster alias of the hijacked `polyfill.io` " +
      "CDN (Sansec polyfill IOC list); treat as compromised.",
  },
  {
    host: "polyfill-cdn.com",
    reason:
      "`polyfill-cdn.com` is a documented Funnull-cluster squat of the hijacked `polyfill.io` " +
      "CDN (Sansec polyfill IOC list); treat as compromised.",
  },
  {
    host: "bootcss.com",
    reason:
      "`bootcss.com` is operated by the same Funnull cluster that hijacked `polyfill.io` and has " +
      "served browser-targeted payloads to consumers loading `<script>` tags from it (Sansec); " +
      "never embed this host in a page Daloy ships or scaffolds.",
  },
  {
    host: "bootcdn.net",
    reason:
      "`bootcdn.net` is part of the Funnull / polyfill.io hijacked-CDN cluster (Sansec); never " +
      "embed in a `<script>` / `<link>` reference from any Daloy template, blog post, or example.",
  },
  {
    host: "staticfile.org",
    reason:
      "`staticfile.org` is part of the Funnull / polyfill.io hijacked-CDN cluster (Sansec); never " +
      "embed in a `<script>` / `<link>` reference from any Daloy template, blog post, or example.",
  },
  {
    host: "staticfile.net",
    reason:
      "`staticfile.net` is part of the Funnull / polyfill.io hijacked-CDN cluster (Sansec); never " +
      "embed in a `<script>` / `<link>` reference from any Daloy template, blog post, or example.",
  },
  {
    host: "unionadjs.com",
    reason:
      "`unionadjs.com` is a documented Funnull-cluster C2 / ad-fraud host named in Silent Push and " +
      "Sansec IOC reporting on the polyfill.io campaign; never reference from any Daloy artifact.",
  },
  {
    host: "xhsbpza.com",
    reason:
      "`xhsbpza.com` is a documented Funnull-cluster C2 / ad-fraud host named in Silent Push and " +
      "Sansec IOC reporting on the polyfill.io campaign; never reference from any Daloy artifact.",
  },
  {
    host: "googie-anaiytics.com",
    reason:
      "`googie-anaiytics.com` is a fake-Google-Analytics typosquat (two `i`s instead of `l`s) used " +
      "by the polyfill.io malware payload to redirect mobile visitors to sports-betting sites " +
      "(Sansec 2024-06-25, Socket 2024-06-26 `namecheap-takes-down-polyfill-io-service-...`); " +
      "any reference is a hard IOC of the Funnull / polyfill.io campaign.",
  },
];

/** Build a case-insensitive regex that matches a host as a DNS label
 *  sequence — i.e. preceded and followed by something other than the
 *  characters that would extend a label (`A-Za-z0-9-`). This keeps
 *  `not-polyfill.io.example` from matching while still catching the host
 *  inside `https://`, `"`, `'`, `<`, `>`, whitespace, or end-of-string. */
function buildHostRegex(host: string): RegExp {
  const escaped = host.replace(/\./g, "\\.");
  return new RegExp(`(^|[^A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`, "i");
}

const HOST_PATTERNS: readonly { readonly re: RegExp; readonly entry: ForbiddenHost }[] =
  FORBIDDEN_HOSTS.map((entry) => ({ re: buildHostRegex(entry.host), entry }));

/** Directory names that are skipped entirely no matter where they appear. */
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-coverage",
  "coverage",
  "temp_tarball",
  "generated",
  ".next",
  "out",
  "build",
  ".turbo",
  ".cache",
  ".vercel",
  ".pnpm-store",
  "_vscode",
]);

/** Repo-relative path prefixes that are skipped (use POSIX separators). */
const SKIP_PATH_PREFIXES: readonly string[] = [
  "tests/",
  "otherdocs/",
  "memory/",
  ".github/copilot-instructions.md",
];

/** Repo-relative exact paths that are skipped. */
const SKIP_EXACT_PATHS: ReadonlySet<string> = new Set([
  "SECURITY.md",
  "PROJECT_HISTORY.md",
  "ROADMAP.md",
  "CODE_REVIEW.md",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "scripts/verify-no-polyfill-cdns.ts",
  "scripts/verify-no-polyfill-cdns.js",
]);

/** File extensions that are scanned. Binary / image / archive types are
 *  ignored — the polyfill IOC is always a textual host reference. */
const SCAN_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".cts",
  ".mts",
  ".js",
  ".jsx",
  ".cjs",
  ".mjs",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".html",
  ".htm",
  ".yml",
  ".yaml",
  ".toml",
  ".css",
  ".scss",
  ".svg",
  ".txt",
]);

function hasScanExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return SCAN_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

function isSkippedPath(relPosix: string): boolean {
  if (SKIP_EXACT_PATHS.has(relPosix)) return true;
  for (const prefix of SKIP_PATH_PREFIXES) {
    if (relPosix === prefix || relPosix.startsWith(prefix)) return true;
  }
  return false;
}

/** Scan a single file's text for forbidden CDN host references. */
export function findForbiddenCdnReferences(
  file: string,
  source: string,
): readonly ForbiddenCdnReference[] {
  const out: ForbiddenCdnReference[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    for (const { re, entry } of HOST_PATTERNS) {
      if (re.test(raw)) {
        out.push({
          file,
          line: i + 1,
          text: raw.trim(),
          host: entry.host,
          reason: entry.reason,
        });
        // One finding per line is enough — the engineer fixing this only
        // needs to see the first IOC to know the line is bad.
        break;
      }
    }
  }
  return out;
}

async function* walk(dir: URL): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      yield* walk(new URL(entry.name + "/", dir));
    } else if (entry.isFile() && hasScanExtension(entry.name)) {
      yield new URL(entry.name, dir).pathname;
    }
  }
}

async function main(): Promise<void> {
  let total = 0;
  try {
    await stat(REPO_ROOT);
  } catch (err) {
    console.error(
      `verify-no-polyfill-cdns: cannot stat repo root: ${(err as Error).message}`,
    );
    process.exitCode = 1;
    return;
  }
  for await (const absolute of walk(REPO_ROOT)) {
    const rel = toPosix(relative(REPO_ROOT.pathname, absolute));
    if (isSkippedPath(rel)) continue;
    const text = await readFile(absolute, "utf8");
    const findings = findForbiddenCdnReferences(rel, text);
    for (const f of findings) {
      console.error(
        `${f.file}:${f.line}: forbidden hijacked-CDN host \`${f.host}\` (${f.reason}): ${f.text}`,
      );
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-polyfill-cdns: ${total} hijacked-CDN host reference${total === 1 ? "" : "s"} ` +
        "found. The DaloyJS repository — runtime source, scaffolded templates, marketing site, " +
        "blog posts, examples — must never reference a host from the Funnull / polyfill.io " +
        "hijacked-CDN cluster (`cdn.polyfill.io`, `polyfill.io`, `polyfill.com`, " +
        "`polyfillcache.com`, `polyfill-cdn.com`, `bootcss.com`, `bootcdn.net`, `staticfile.org`, " +
        "`staticfile.net`, `unionadjs.com`, `xhsbpza.com`, `googie-anaiytics.com`). All of these served live malware in " +
        "the February–June 2024 polyfill.io supply-chain compromise or are documented " +
        "Funnull-cluster aliases / C2 hosts. Replace with Cloudflare's mirror at " +
        "`cdnjs.cloudflare.com/polyfill/`, Fastly's mirror at `polyfill-fastly.io`, or — " +
        "preferred — a self-hosted bundle pinned to a known-good version with Subresource " +
        "Integrity (SRI) `integrity=\"sha384-...\"` and `crossorigin=\"anonymous\"`. See " +
        "https://www.aikido.dev/blog/polyfill-io-supply-chain-attack-what-do-you-need-to-do and " +
        "https://sansec.io/research/polyfill-supply-chain-attack.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-polyfill-cdns.ts")) {
  await main();
}
