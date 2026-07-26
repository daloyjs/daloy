/**
 * Pre-publish "ToxicSkills" gate (Snyk / Tessl 2026-03 partnership).
 *
 * Sibling to `verify-no-leaky-agent-skills.ts`. Where that gate targets
 * the OpenClaw / ClawHub *credential-leak* class (instructions that
 * keep the secret inside the LLM context), this gate targets the
 * *ToxicSkills* class documented in Snyk's March-2026 write-up
 * <https://snyk.io/blog/snyk-tessl-partnership/> and the Snyk research
 * post it cites: 36% of 3 984 scanned ClawHub skills contained
 * prompt-injection techniques, and every confirmed-malicious skill
 * combined a code payload with natural-language injection.
 *
 * The blog quotes the canonical concrete attack: **three lines of
 * markdown in a SKILL.md file were enough to instruct an agent to read
 * SSH keys and exfiltrate them to the attacker's infrastructure**.
 * Traditional scanners skip markdown — the exploit is in plain English.
 *
 * The patterns below are deliberately tight: descriptive security
 * guidance ("never pipe `curl` to `bash`") must not trip the gate. We
 * only flag the *imperative* form an attacker uses — a literal pipeline
 * the agent is told to execute, a literal sensitive-file path the agent
 * is told to read and ship out, or a literal system-prompt-override
 * phrase.
 *
 * Categories (each pattern carries its taxonomy id):
 *
 *  - `curl-pipe-to-shell` — `curl … | bash` / `wget … | sh` /
 *    `iwr … | iex` style remote-execution one-liners. The classic
 *    install-script-becomes-malware delivery vector that ToxicSkills
 *    skills use to fetch a second-stage payload from the attacker's
 *    infrastructure. See Snyk Learn "Excessive Agency" and the
 *    ToxicSkills "suspicious external downloads" category.
 *
 *  - `private-key-exfil` — instructions that name a private-key /
 *    cloud-credential path (`~/.ssh/id_rsa`, `~/.aws/credentials`,
 *    `/etc/shadow`, …) alongside a read/copy/upload verb. This is the
 *    "three lines of markdown" pattern the Snyk-Tessl blog cites by
 *    name.
 *
 *  - `prompt-injection-override` — explicit "ignore (the) previous
 *    instructions" / "disregard the above" / "forget your system
 *    prompt" jailbreak phrasing. ToxicSkills used this to override
 *    the host's system prompt at skill-invocation time.
 *
 *  - `base64-decode-exec` — `base64 -d | bash`, `eval(atob(...))`, and
 *    other "decode-then-run" pipelines. Catches the obfuscated /
 *    base64-encoded variant of the injection class that the Snyk-Tessl
 *    blog explicitly calls out ("including obfuscated and
 *    base64-encoded variants").
 *
 *  - `imds-from-skill` — instructions to fetch
 *    `169.254.169.254/latest/meta-data/...` (or AWS/GCP/Azure IMDS
 *    siblings) from the agent. A skill running inside a cloud dev
 *    environment can steal short-lived instance creds via IMDSv1 if
 *    told to.
 *
 * Scope: every agent-instruction file under the repo (`SKILL.md`,
 * `AGENTS.md`, `copilot-instructions.md`, `.cursorrules`, `CLAUDE.md`,
 * `*.instructions.md`, `*.prompt.md`) — including the website's
 * `.agents/skills/` tree and every
 * `packages/create-daloy/templates/<tpl>/_agents/skills/` directory
 * that ships verbatim to scaffolded projects.
 *
 * Exit codes:
 *   0 — no ToxicSkills patterns found.
 *   1 — at least one finding; offending paths/lines printed to stderr.
 *
 * @since 0.34.5
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

const REPO_ROOT = process.cwd();

/**
 * Filename patterns treated as agent-instruction surfaces. Mirrors the
 * sister `verify-no-leaky-agent-skills` gate.
 *
 * `.cursorrules` (Cursor) and `CLAUDE.md` (Claude Code) are included
 * because the **TrapDoor** crypto-stealer campaign (Socket,
 * 2026-05-24, <https://socket.dev/blog/trapdoor-crypto-stealer>)
 * weaponized exactly these two filenames: across 34+ malicious
 * npm / PyPI / Crates.io packages the operator (`ddjidd564`) wrote
 * `.cursorrules` and `CLAUDE.md` instruction files carrying
 * zero-width-Unicode-hidden prompt injection that tricks an AI
 * assistant into running a fake "security scan" which exfiltrates SSH
 * keys, wallet data, and cloud credentials. They are now first-class
 * agent-instruction surfaces alongside `copilot-instructions.md`, so
 * the ToxicSkills scanner must inspect them too.
 */
const SKILL_FILENAME_PATTERNS: readonly RegExp[] = [
  /^SKILL\.md$/i,
  /^AGENTS\.md$/i,
  /^copilot-instructions\.md$/i,
  /^\.cursorrules$/i,
  /^CLAUDE\.md$/i,
  /\.instructions\.md$/i,
  /\.prompt\.md$/i,
];

/** Repo-relative path prefixes that the walker never descends into. */
const SKIP_DIR_PREFIXES: readonly string[] = [
  "node_modules/",
  ".git/",
  "dist/",
  "dist-coverage/",
  "coverage/",
  "temp_tarball/",
  "generated/",
  "otherdocs/",
];

/**
 * Files exempt from scanning: the gate's own source, its tests, and
 * security-policy / project-history documents that must be able to
 * quote the attack strings verbatim. Listed in POSIX-relative form.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
  "scripts/verify-no-toxic-agent-skills.ts",
  "tests/verify-no-toxic-agent-skills.test.ts",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_REVIEW.md",
  "README.md",
]);

/** A single ToxicSkills-class anti-pattern signature. */
export interface ToxicPattern {
  readonly id: string;
  readonly re: RegExp;
  readonly why: string;
}

/**
 * High-precision anti-pattern signatures. Each one matches the
 * *imperative* form an attacker uses inside a SKILL.md; descriptive
 * "never do X" prose must not trigger.
 */
export const TOXIC_SKILL_PATTERNS: readonly ToxicPattern[] = Object.freeze([
  {
    id: "curl-pipe-to-shell",
    // `curl … | bash`, `wget … | sh`, `iwr … | iex`, optionally with
    // `sudo`. The pipe (`|`) to a shell interpreter on the same line is
    // the distinguishing imperative form — prose like "do not curl this
    // and pipe to bash" lacks the literal `|` followed by a shell name.
    re: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n|]{1,400}\|\s*(?:sudo\s+)?(?:bash|sh|zsh|fish|ksh|dash|python3?|node|deno|bun|powershell|pwsh|iex)\b/i,
    why: "ToxicSkills 'suspicious external download' anti-pattern — a literal `curl … | bash` / `wget … | sh` / `iwr … | iex` pipeline drops a second-stage payload from an attacker URL into the developer's shell with the developer's privileges (Snyk-Tessl 2026-03 ToxicSkills taxonomy).",
  },
  {
    id: "private-key-exfil",
    // A verb that reads/copies/uploads/encodes a file path immediately
    // followed (within 80 chars) by an unambiguous private-key or cloud-
    // credential path. We anchor on the path tokens — `id_rsa`,
    // `id_ed25519`, `id_ecdsa`, `id_dsa`, `~/.aws/credentials`,
    // `/etc/shadow`, `~/.gnupg/secring`, `~/.kube/config`,
    // `~/.docker/config.json`, `~/.netrc` — all of which are private
    // material that no legitimate skill should be telling an agent to
    // read and ship out.
    re: /\b(?:cat|read|copy|cp|upload|send|post|push|exfiltrate|email|tar|zip|gzip|base64|curl(?:\s+-[A-Za-z]+)?\s+(?:--data|-d|-T|--upload-file)|scp|rsync)\b[^\n]{0,80}(?:~\/\.ssh\/id_(?:rsa|ed25519|ecdsa|dsa)|\/\.ssh\/id_(?:rsa|ed25519|ecdsa|dsa)\b|~\/\.aws\/credentials\b|\/etc\/shadow\b|~\/\.gnupg\/secring\b|~\/\.kube\/config\b|~\/\.docker\/config\.json\b|~\/\.netrc\b|~\/\.npmrc\b)/i,
    why: "ToxicSkills 'toxic flow' anti-pattern — an instruction that reads private-key / cloud-credential material and ships it outside the dev box. The Snyk-Tessl 2026-03 blog cites this as the canonical 'three lines of markdown exfiltrate SSH keys' attack.",
  },
  {
    id: "prompt-injection-override",
    // Explicit jailbreak phrasing. The verb + qualifier + object trio
    // is intentionally narrow so defensive prose ("never tell the agent
    // to ignore the system prompt") would not match without the
    // imperative form (we require `(?!.*\bdo not\b|\bnever\b|\bdon't\b)`
    // on the same line via a negative-lookahead-style scan in code).
    re: /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|earlier|preceding|above|system)\s+(?:instructions?|prompts?|rules?|directives?|messages?|system\s+prompt|guidelines?)\b/i,
    why: "ToxicSkills 'prompt-injection override' anti-pattern — phrasing that tells the agent to discard the host's system prompt. Snyk-Tessl 2026-03 reports 36% of 3 984 scanned ClawHub skills carry this technique.",
  },
  {
    id: "base64-decode-exec",
    // Decode-then-run pipelines. The two canonical forms are
    // `base64 -d | (bash|sh|eval|python|node)` and
    // `eval(atob('...'))` / `Function(atob('...'))()`. The
    // Snyk-Tessl blog explicitly flags "obfuscated and base64-encoded
    // variants" of the injection class.
    re: /\bbase64\s+(?:-d|--decode|-D)\b[^\n|]{0,200}\|\s*(?:bash|sh|zsh|eval|node|deno|python3?|powershell|pwsh|iex)\b|\b(?:eval|Function|setTimeout|setInterval)\s*\(\s*(?:globalThis\.)?atob\s*\(/i,
    why: "ToxicSkills 'obfuscated payload' anti-pattern — `base64 -d | bash` / `eval(atob(...))` style decode-then-run pipelines hide the actual command from human PR review. Explicitly named in the Snyk-Tessl 2026-03 blog as one of the variants their behavioral-intent scanner detects.",
  },
  {
    id: "imds-from-skill",
    // Cloud Instance Metadata Service endpoints. Stealing the IMDS
    // role-credential response from inside a dev environment is the
    // exact Capital-One-class escalation; a skill running in a
    // cloud-hosted dev container or Cloud Workstation that follows
    // an instruction to `curl 169.254.169.254/...` hands the
    // attacker short-lived IAM credentials.
    re: /\b(?:curl|wget|fetch|http|invoke-restmethod|invoke-webrequest|iwr)\b[^\n]{0,200}\b(?:169\.254\.169\.254|metadata\.google\.internal|metadata\.aws\.internal|fd00:ec2::254)\b/i,
    why: "ToxicSkills 'toxic flow' anti-pattern — instruction to hit the cloud Instance Metadata Service (169.254.169.254 / metadata.google.internal / etc.) from a skill. Inside a cloud-hosted dev container this returns short-lived IAM credentials; same primitive as the Capital One 2019 IMDS-via-SSRF breach.",
  },
]);

export interface ToxicFinding {
  readonly file: string;
  readonly line: number;
  readonly id: string;
  readonly excerpt: string;
  readonly why: string;
}

/**
 * True when `basename` names an agent-instruction surface the gate must
 * scan (`SKILL.md`, `AGENTS.md`, `copilot-instructions.md`,
 * `.cursorrules`, `CLAUDE.md`, `*.instructions.md`, `*.prompt.md`).
 * Exposed for tests.
 *
 * @param basename - The file's basename (no directory component).
 * @returns `true` if the file is an agent-instruction surface.
 */
export function isSkillFilename(basename: string): boolean {
  return SKILL_FILENAME_PATTERNS.some((re) => re.test(basename));
}

function isSkippedDir(relPath: string): boolean {
  const posixPath = relPath.split(sep).join("/");
  return SKIP_DIR_PREFIXES.some(
    (p) => posixPath === p.replace(/\/$/, "") || posixPath.startsWith(p)
  );
}

async function* walkAgentFiles(root: string): AsyncIterable<string> {
  async function* recurse(dir: string): AsyncIterable<string> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      const rel = relative(root, full);
      if (isSkippedDir(rel)) continue;
      if (ent.isDirectory()) {
        yield* recurse(full);
      } else if (ent.isFile() && isSkillFilename(ent.name)) {
        yield full;
      }
    }
  }
  const s = await stat(root).catch(() => null);
  if (s && s.isDirectory()) {
    yield* recurse(root);
  }
}

/**
 * Per-line negative qualifier — descriptive guidance like "never
 * pipe `curl` to `bash`" or "do not ignore prior instructions"
 * documents the attack rather than instructing it. The qualifier
 * matches the well-known prohibition verbs at the start of the
 * effective sentence segment.
 */
const PROSE_NEGATION =
  /\b(?:never|do not|don't|avoid|refuse to|must not|should not|shouldn't|forbidden|prohibited)\b/i;

/**
 * Pure scanner: given a file's textual content, return every line that
 * matches a ToxicSkills anti-pattern signature. Exposed for tests.
 */
export function scanForToxicSkillPatterns(source: string): readonly Omit<ToxicFinding, "file">[] {
  const out: Omit<ToxicFinding, "file">[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // A leading prose-negation on the same line means this is the
    // skill *documenting* the attack rather than telling the agent
    // to perform it — skip. This keeps prescriptive security guidance
    // ("never `curl | bash`") from tripping the gate.
    if (PROSE_NEGATION.test(line)) continue;
    for (const pattern of TOXIC_SKILL_PATTERNS) {
      if (pattern.re.test(line)) {
        out.push({
          line: i + 1,
          id: pattern.id,
          excerpt: line.trim().slice(0, 200),
          why: pattern.why,
        });
      }
    }
  }
  return out;
}

export async function findToxicAgentSkills(
  rootDir: string = REPO_ROOT
): Promise<readonly ToxicFinding[]> {
  const findings: ToxicFinding[] = [];
  for await (const file of walkAgentFiles(rootDir)) {
    const rel = posix.normalize(relative(rootDir, file).split(sep).join("/"));
    if (ALLOWLIST.has(rel)) continue;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const hit of scanForToxicSkillPatterns(text)) {
      findings.push({ file: rel, ...hit });
    }
  }
  return findings;
}

async function main(): Promise<void> {
  const findings = await findToxicAgentSkills();
  for (const f of findings) {
    console.error(`${f.file}:${f.line} [${f.id}] ${f.why}`);
    console.error(`    > ${f.excerpt}`);
  }
  if (findings.length > 0) {
    console.error(
      `verify-no-toxic-agent-skills: ${findings.length} ToxicSkills ` +
        `anti-pattern${findings.length === 1 ? "" : "s"} detected in ` +
        "agent-instruction files. Rewrite the instruction so it cannot " +
        "tell an AI agent to download-and-run a remote script, exfiltrate " +
        "private keys / cloud credentials, override the host's system " +
        "prompt, decode-then-execute an obfuscated payload, or query the " +
        "cloud Instance Metadata Service. See " +
        "https://snyk.io/blog/snyk-tessl-partnership/."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-toxic-agent-skills.ts")) {
  await main();
}
