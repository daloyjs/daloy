import { readFile } from "node:fs/promises";

export interface ForbiddenLockfileSource {
  line: number;
  reason:
    | "git dependency source"
    | "non-registry tarball source"
    | "known-malicious package (Lazarus BeaverTail / InvisibleFerret)"
    | "known-malicious package (xuxingfeng destructive-payload campaign, May 2025)"
    | "known-malicious package (naya-flore WhatsApp remote-kill-switch campaign, August 2025)"
    | "known-compromised version (Qix / DuckDB crypto-clipper, Sep 2025)";
  text: string;
}

const GIT_SOURCE_PATTERN =
  /(?:specifier:\s*)?(?:github:|gitlab:|bitbucket:|gist:|git\+|git:\/\/|ssh:\/\/git@|git@github\.com:|git@gitlab\.com:|git@bitbucket\.org:)/i;
const TARBALL_PATTERN = /tarball:\s*(?<url>https?:\/\/[^}\s]+)/i;
const REGISTRY_TARBALL_PREFIX = "https://registry.npmjs.org/";

/**
 * Known-malicious npm package names that must NEVER appear in
 * Daloy's `pnpm-lock.yaml`, either as direct dependencies or as
 * resolved transitive deps.
 *
 * **Lazarus BeaverTail / InvisibleFerret (Socket 2025-03-10,
 * https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages):**
 * six typosquatted packages published by Lazarus-linked npm
 * aliases that embed BeaverTail (browser-credential + crypto-wallet
 * stealer) and download the InvisibleFerret backdoor as a
 * second-stage payload. The names mimic widely-trusted validator
 * libraries (`is-buffer-validator` typosquats Feross Aboukhadijeh's
 * `is-buffer`, etc.). At write time the packages remain live on
 * the npm registry pending removal — pinning the names here means
 * that a future PR that accidentally pulls one of them in (e.g. via
 * a transitive dep update) is rejected at CI before merge.
 *
 * The package list is conservative and exact-match only: it does
 * NOT touch the legitimate `is-buffer` package, only the typosquat
 * `is-buffer-validator`.
 *
 * **xuxingfeng destructive-payload campaign (Socket 2025-05-21,
 * https://socket.dev/blog/malicious-npm-packages-target-react-vue-and-vite-ecosystems-with-destructive-payloads):**
 * eight npm packages published over two years by the alias
 * `xuxingfeng` (`1634389031@qq.com`) that typosquat or mimic popular
 * Vite / React / Vue / Quill plugins. The packages embed time-delayed
 * payloads that (a) `process.execSync` `rimraf` / `rm -rf` against
 * `node_modules/{vite,vue,react,vue-router,ant-design-vue,axios,less,
 * typescript,...}`, (b) `shutdown -s -t 5` the host every second, (c)
 * monkey-patch `Array.prototype.{filter,map,push,pop,splice,...}` and
 * `String.prototype.{split,replaceAll,substr,trim,...}` to return random
 * characters, and (d) corrupt `localStorage` / `sessionStorage` /
 * `document.cookie` from a Vue `install(app)` plugin shim. The earliest
 * activation date has passed, the final phase has no end date, and the
 * packages remain live on npm pending removal — pinning the names here
 * means that a future PR (or transitive update) that pulls one of them
 * in is rejected at CI before merge.
 */
const KNOWN_MALICIOUS_PACKAGES: ReadonlyMap<string, ForbiddenLockfileSource["reason"]> = new Map([
  // Lazarus BeaverTail / InvisibleFerret (March 2025)
  ["is-buffer-validator", "known-malicious package (Lazarus BeaverTail / InvisibleFerret)"],
  ["yoojae-validator", "known-malicious package (Lazarus BeaverTail / InvisibleFerret)"],
  ["event-handle-package", "known-malicious package (Lazarus BeaverTail / InvisibleFerret)"],
  ["array-empty-validator", "known-malicious package (Lazarus BeaverTail / InvisibleFerret)"],
  ["react-event-dependency", "known-malicious package (Lazarus BeaverTail / InvisibleFerret)"],
  ["auth-validator", "known-malicious package (Lazarus BeaverTail / InvisibleFerret)"],
  // xuxingfeng destructive-payload campaign (Socket 2025-05-21) — exact
  // names of the eight Vite / Vue / React / Quill mimics. Does NOT touch
  // any legitimate `@vitejs/plugin-react`, `@vitejs/plugin-vue`,
  // `vite-plugin-html`, `quill-image-uploader`, `quill-image-drop-module`,
  // or `quill-image-resize-module` package.
  ["js-bomb", "known-malicious package (xuxingfeng destructive-payload campaign, May 2025)"],
  ["js-hood", "known-malicious package (xuxingfeng destructive-payload campaign, May 2025)"],
  ["vite-plugin-bomb", "known-malicious package (xuxingfeng destructive-payload campaign, May 2025)"],
  ["vite-plugin-bomb-extend", "known-malicious package (xuxingfeng destructive-payload campaign, May 2025)"],
  ["vite-plugin-react-extend", "known-malicious package (xuxingfeng destructive-payload campaign, May 2025)"],
  ["vite-plugin-vue-extend", "known-malicious package (xuxingfeng destructive-payload campaign, May 2025)"],
  ["vue-plugin-bomb", "known-malicious package (xuxingfeng destructive-payload campaign, May 2025)"],
  ["quill-image-downloader", "known-malicious package (xuxingfeng destructive-payload campaign, May 2025)"],
  // naya-flore / nvlore-hsc WhatsApp remote-kill-switch campaign
  // (Socket 2025-08-06,
  // https://socket.dev/blog/malicious-npm-packages-target-whatsapp-developers-with-remote-kill-switch)
  // — two packages masquerading as WhatsApp socket libraries (à la
  // `baileys` / `whatsapp-web.js`) embed a phone-number-keyed remote
  // kill switch that fetches a GitHub-hosted whitelist and runs
  // `exec('rm -rf *')` from `requestPairingCode` if the developer's
  // phone number is not whitelisted. The same nayflore (`nayflore`,
  // `idzzcch@gmail.com`) author published five additional packages
  // that currently appear benign but are listed as IOCs in the Socket
  // write-up — pin all seven by exact name so any future PR that
  // pulls one in (direct or transitive) is rejected at CI before
  // merge.
  ["naya-flore", "known-malicious package (naya-flore WhatsApp remote-kill-switch campaign, August 2025)"],
  ["nvlore-hsc", "known-malicious package (naya-flore WhatsApp remote-kill-switch campaign, August 2025)"],
  // The five sibling packages below are author-IOCs from the same
  // `nayflore` npm account — currently benign per Socket but treated
  // as malicious here so a future weaponised republish is rejected at
  // CI before merge.
  ["nouku-search", "known-malicious package (naya-flore WhatsApp remote-kill-switch campaign, August 2025)"],
  ["very-nay", "known-malicious package (naya-flore WhatsApp remote-kill-switch campaign, August 2025)"],
  ["naya-clone", "known-malicious package (naya-flore WhatsApp remote-kill-switch campaign, August 2025)"],
  ["node-smsk", "known-malicious package (naya-flore WhatsApp remote-kill-switch campaign, August 2025)"],
  ["@veryflore/disc", "known-malicious package (naya-flore WhatsApp remote-kill-switch campaign, August 2025)"],
]);

/**
 * Known-compromised `name@version` pairs for legitimate, widely-used npm
 * packages whose maintainer accounts were phished and used to publish a
 * crypto-clipper payload. These names are NOT malicious in general —
 * untainted versions remain safe to install — but the exact versions
 * listed here must never appear in any lockfile we ship or scaffold.
 *
 * **Qix campaign (Socket 2025-09-08,
 * https://socket.dev/blog/npm-author-qix-compromised-in-major-supply-chain-attack):**
 * the maintainer "Qix" (Josh Junon) was phished via a fake `npmjs.help`
 * 2FA-reset email and the attacker published trojanised versions of 18
 * foundational packages (chalk, debug, ansi-styles, strip-ansi, etc.)
 * with combined weekly downloads in the billions. The payload only
 * activates in a browser context — it hooks `window.fetch`,
 * `XMLHttpRequest`, and `window.ethereum.request`, then rewrites
 * cryptocurrency addresses (ETH / BTC legacy / BTC SegWit / TRON / LTC
 * / BCH / SOL) inside response bodies and signed-transaction payloads
 * by picking the attacker-controlled wallet with the closest
 * Levenshtein distance to the victim's address. Daloy itself is a
 * Node.js framework and would not detonate the payload, but a Daloy
 * application that bundles its OpenAPI client or admin UI for the
 * browser absolutely would. The Aikido write-up
 * (https://www.aikido.dev/blog/duckdb-npm-packages-compromised) covers
 * the same campaign's follow-on wave against the `@duckdb/*`
 * maintainer using the identical malware family.
 *
 * Defence-in-depth: `minimum-release-age=1440` in `.npmrc` already
 * gives us a 24h cooldown that would have caught every one of these
 * (they were all yanked within hours), but this exact-version
 * blocklist is the belt-and-suspenders guarantee in case a future
 * contributor disables the cooldown for a hotfix or runs with an
 * `--ignore-workspace` install.
 */
const KNOWN_COMPROMISED_VERSIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  // Qix / Sep 8, 2025 — chalk-debug crypto-clipper wave
  ["ansi-regex", new Set(["6.2.1"])],
  ["ansi-styles", new Set(["6.2.2"])],
  ["backslash", new Set(["0.2.1"])],
  ["chalk", new Set(["5.6.1"])],
  ["chalk-template", new Set(["1.1.1"])],
  ["color-convert", new Set(["3.1.1"])],
  ["color-name", new Set(["2.0.1"])],
  ["color-string", new Set(["2.1.1"])],
  ["debug", new Set(["4.4.2"])],
  ["error-ex", new Set(["1.3.3"])],
  ["has-ansi", new Set(["6.0.1"])],
  ["is-arrayish", new Set(["0.3.3"])],
  ["proto-tinker-wc", new Set(["1.8.7", "0.1.87"])],
  ["simple-swizzle", new Set(["0.2.3"])],
  ["slice-ansi", new Set(["7.1.1"])],
  ["strip-ansi", new Set(["7.1.1"])],
  ["supports-color", new Set(["10.2.1"])],
  ["supports-hyperlinks", new Set(["4.1.1"])],
  ["wrap-ansi", new Set(["9.0.1"])],
]);

/**
 * Match a `name@version` pair against {@link KNOWN_COMPROMISED_VERSIONS}.
 * Used for both pnpm-lock.yaml key lines and dependency-map entries
 * where a precise version is present.
 */
function isCompromisedNameVersion(name: string, version: string): boolean {
  const versions = KNOWN_COMPROMISED_VERSIONS.get(name);
  if (versions === undefined) return false;
  // pnpm lockfile sometimes appends a peer-dep suffix like `4.4.2(supports-color@10.2.1)`.
  // Compare against the bare version prefix.
  const bareVersion = version.replace(/\(.*$/, "").trim();
  return versions.has(bareVersion);
}

/**
 * Match a pnpm-lock.yaml `packages:` key or `/<name>@<version>:`
 * snapshot key against the malicious-package blocklist. pnpm v9+
 * lockfile v9 uses keys like `'is-buffer-validator@1.0.0':` under
 * `packages:` and `snapshots:`, and a `name:` field under each
 * package entry. We grep all three shapes.
 */
function findMaliciousPackageOnLine(
  line: string,
): { name: string; reason: ForbiddenLockfileSource["reason"] } | null {
  const trimmed = line.trim();
  // Pattern A: pnpm v9 lockfile key — `'name@version':` or `name@version:`
  //            with optional leading slash for v6 compatibility.
  const keyMatch =
    /^['"]?\/?(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)@[^:'"]+['"]?\s*:/i.exec(
      trimmed,
    );
  if (keyMatch) {
    const name = keyMatch[1]!;
    const reason = KNOWN_MALICIOUS_PACKAGES.get(name);
    if (reason !== undefined) return { name, reason };
  }
  // Pattern B: explicit `name: <name>` field inside a package entry.
  const nameField = /^name:\s*['"]?(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)['"]?\s*$/i
    .exec(trimmed);
  if (nameField) {
    const name = nameField[1]!;
    const reason = KNOWN_MALICIOUS_PACKAGES.get(name);
    if (reason !== undefined) return { name, reason };
  }
  // Pattern C: a dependency-map entry like `is-buffer-validator: 1.0.0`
  //            under `dependencies:` / `devDependencies:` / `specifiers:`.
  const depEntry =
    /^(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?):\s*[\^~]?[\d.]+/i.exec(trimmed);
  if (depEntry) {
    const name = depEntry[1]!;
    const reason = KNOWN_MALICIOUS_PACKAGES.get(name);
    if (reason !== undefined) return { name, reason };
  }
  return null;
}

/**
 * Match a pnpm-lock.yaml line against {@link KNOWN_COMPROMISED_VERSIONS}.
 * Returns the offending `name@version` string for diagnostics, or `null`
 * when nothing on the line is compromised.
 */
function findCompromisedVersionOnLine(line: string): string | null {
  const trimmed = line.trim();
  // Pattern A: pnpm v9 lockfile key — `'name@version':` (with optional leading
  // slash for v6 compatibility). The version captures everything up to the
  // closing quote / colon, including any peer-dep `(...)` suffix that pnpm
  // appends for cross-version disambiguation.
  const keyMatch =
    /^['"]?\/?(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)@([^:'"]+)['"]?\s*:/i.exec(
      trimmed,
    );
  if (keyMatch) {
    const name = keyMatch[1]!;
    const version = keyMatch[2]!;
    if (isCompromisedNameVersion(name, version)) return `${name}@${version}`;
  }
  // Pattern B: a dependency-map entry like `chalk: 5.6.1` under
  // `dependencies:` / `devDependencies:` / `specifiers:`.
  const depEntry =
    /^(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?):\s*['"]?[\^~]?([\d.]+(?:[-+][\w.-]+)?)['"]?\s*$/i.exec(
      trimmed,
    );
  if (depEntry) {
    const name = depEntry[1]!;
    const version = depEntry[2]!;
    if (isCompromisedNameVersion(name, version)) return `${name}@${version}`;
  }
  return null;
}

export function findForbiddenLockfileSources(lockfile: string): ForbiddenLockfileSource[] {
  const findings: ForbiddenLockfileSource[] = [];
  const lines = lockfile.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const text = rawLine.trim();
    if (GIT_SOURCE_PATTERN.test(text)) {
      findings.push({ line: index + 1, reason: "git dependency source", text });
      continue;
    }

    const tarball = TARBALL_PATTERN.exec(text)?.groups?.url;
    if (tarball && !tarball.startsWith(REGISTRY_TARBALL_PREFIX)) {
      findings.push({ line: index + 1, reason: "non-registry tarball source", text });
      continue;
    }

    const malicious = findMaliciousPackageOnLine(rawLine);
    if (malicious !== null) {
      findings.push({
        line: index + 1,
        reason: malicious.reason,
        text,
      });
      continue;
    }

    const compromised = findCompromisedVersionOnLine(rawLine);
    if (compromised !== null) {
      findings.push({
        line: index + 1,
        reason: "known-compromised version (Qix / DuckDB crypto-clipper, Sep 2025)",
        text,
      });
    }
  }
  return findings;
}

async function main(): Promise<void> {
  const lockfiles = ["../pnpm-lock.yaml", "../website/pnpm-lock.yaml"] as const;
  let total = 0;
  for (const rel of lockfiles) {
    const lockfile = await readFile(new URL(rel, import.meta.url), "utf8");
    const findings = findForbiddenLockfileSources(lockfile);
    for (const finding of findings) {
      console.error(
        `${rel.replace(/^\.\.\//, "")} ${finding.reason} on line ${finding.line}: ${finding.text}`,
      );
    }
    total += findings.length;
  }
  if (total > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-lockfile-sources.ts")) {
  await main();
}
