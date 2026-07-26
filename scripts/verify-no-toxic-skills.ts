/**
 * ToxicSkills agent-skill content gate (Snyk Labs ToxicSkills class).
 *
 * Snyk's 2026-02-05 write-up
 * (https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)
 * audited 3,984 agent skills published to ClawHub / skills.sh and found
 * that **13.4 %** contained at least one CRITICAL security issue and
 * **76 skills** carried active malicious payloads — credential theft,
 * backdoor installation, prompt injection, remote-script execution, and
 * base64-obfuscated exfiltration. Unlike traditional packages, an agent
 * skill inherits the **full permissions of the AI agent that loads it**:
 * shell, file system, env vars, outbound network. A malicious SKILL.md
 * is, in effect, a `postinstall` script with persistence.
 *
 * Daloy publishes agent-skill files in two places:
 *
 *   - `packages/create-daloy/templates/<runtime>/_agents/skills/<id>/SKILL.md`
 *     — scaffolded into every newly created Daloy app under
 *       `.agents/skills/<id>/SKILL.md` so the user's AI coding agent
 *       (Claude Code, Cursor, Copilot, etc.) has on-disk operational
 *       guidance for their project.
 *   - `website/.agents/skills/<id>/SKILL.md` — first-party guidance the
 *     marketing/docs site contributors use locally.
 *
 * Both surfaces are "skills we publish to our users". This gate scans
 * every skill / instruction / prompt markdown file in the repo for the
 * three CRITICAL ToxicSkills attack patterns:
 *
 *   1. **Remote-script execution.**  `curl|wget|iwr … | sh|bash|zsh|iex`,
 *      `eval $(curl …)`, PowerShell `Invoke-Expression`-of-fetched-text.
 *      The most common malicious-skill primitive in the ToxicSkills
 *      corpus (matches ToxicSkills "Malicious code detection" and
 *      "Suspicious download detection").
 *   2. **Base64-decoded payloads.**  `base64 -d`, `base64 --decode`,
 *      `openssl enc -d -base64`, `echo … | base64 -d`. Used to hide
 *      C2 URLs and shell payloads inside an otherwise innocuous skill
 *      (matches ToxicSkills "Prompt injection detection — base64
 *      obfuscation" and "Malicious code detection").
 *   3. **Hardcoded secrets.**  AWS access keys, GitHub PATs, OpenAI
 *      keys, Anthropic keys, Slack tokens, Google API keys (matches
 *      ToxicSkills "Secret detection" — 10.9 % exposure rate in the
 *      ClawHub corpus). A leaked maintainer credential in a SKILL.md
 *      we ship is equivalent to leaking it in `dist/`.
 *
 * Intentionally NOT covered by this gate (false-positive risk too high
 * for the kind of operational guidance our skills legitimately contain):
 *
 *   - "Ignore previous instructions" / prompt-injection English phrases.
 *     Real skills sometimes document the threat by name.
 *   - Arbitrary outbound `fetch()` / `https://` URLs. Skills cite docs.
 *   - Crypto / financial keywords ("Direct money access" in ToxicSkills).
 *
 * Scope:
 *
 *   - `**\/SKILL.md`               — every published / scaffolded skill.
 *   - `**\/AGENTS.md`              — repo-level agent instructions.
 *   - `**\/copilot-instructions.md`— GitHub Copilot agent instructions.
 *   - `**\/*.instructions.md`      — VS Code Copilot custom instructions.
 *   - `**\/*.prompt.md`            — VS Code prompt files.
 *   - `**\/*.agent.md`             — generic per-agent overrides.
 *
 * Skipped by design:
 *
 *   - Standard generated / vendored dirs (mirrors other verify gates).
 *   - `tests/**` — the gate's own test fixtures must contain the IOCs.
 *   - `otherdocs/**` — internal security-research notes that quote
 *     ToxicSkills attack samples verbatim.
 *   - `SECURITY.md`, `ROADMAP.md`, `CODE_REVIEW.md`
 *     — disclosure / release documentation that names the campaign and
 *     may reproduce payload examples.
 *   - The verify script itself and its compiled `.js` twin.
 *
 * Exit code:
 *   0 — every scanned skill / instruction file is free of the CRITICAL
 *       ToxicSkills patterns.
 *   1 — at least one was found; offending lines printed to stderr with
 *       the category and the ToxicSkills citation.
 *
 * @since 0.34.5
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = new URL("../", import.meta.url);

export interface ToxicSkillFinding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly category: string;
  readonly reason: string;
}

interface Detector {
  readonly category: string;
  readonly re: RegExp;
  readonly reason: string;
}

/**
 * Detector set. Every entry maps to a CRITICAL row in the ToxicSkills
 * taxonomy. Patterns are deliberately conservative so the gate stays
 * false-positive-free on legitimate operational guidance (pnpm/npm
 * commands, doc URLs, code-fence snippets that show input/output).
 */
const DETECTORS: readonly Detector[] = [
  {
    category: "remote-script-execution",
    // curl/wget/fetch piped into a POSIX shell. Anchored on the pipe so
    // documentation that mentions `curl ...` without piping it to a
    // shell is not flagged. Matches `curl URL | sh`, `curl URL | bash`,
    // `wget -qO- URL | sh`, etc. across one logical line.
    re: /\b(?:curl|wget|fetch)\b[^\n|`]{0,400}\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh|fish)\b/i,
    reason:
      "remote-script execution pattern (`curl|wget … | sh|bash|zsh|dash|fish`) — the primary " +
      "malicious-skill primitive in Snyk's ToxicSkills corpus (2026-02-05); a SKILL.md must never " +
      "instruct an AI agent to run unverified remote scripts.",
  },
  {
    category: "remote-script-execution",
    // PowerShell variant: `iwr URL | iex` or `Invoke-WebRequest URL | Invoke-Expression`.
    re: /\b(?:iwr|invoke-webrequest|wget)\b[^\n|`]{0,400}\|\s*(?:iex|invoke-expression)\b/i,
    reason:
      "PowerShell remote-script execution pattern (`iwr URL | iex` / `Invoke-Expression`) — " +
      "ToxicSkills equivalent of the curl|bash pipe on Windows agents.",
  },
  {
    category: "remote-script-execution",
    // `eval $(curl ...)` / `eval "$(wget ...)"` shell-expansion of remote content.
    re: /\beval\b[^\n`]{0,40}["'`]?\$\(\s*(?:curl|wget|fetch)\b/i,
    reason:
      "shell-expansion remote-execution pattern (`eval $(curl …)`) — ToxicSkills CRITICAL " +
      "malicious-code detection class.",
  },
  {
    category: "base64-obfuscation",
    // `base64 -d`, `base64 --decode`, `openssl enc -d -base64`, `openssl base64 -d`.
    re: /\bbase64\s+(?:-d|--decode)\b|\bopenssl\s+(?:enc\s+-d\s+-base64|base64\s+-d)\b/i,
    reason:
      "base64-decode primitive — ToxicSkills documents base64 obfuscation as the dominant way to " +
      "hide C2 URLs and shell payloads inside a SKILL.md (Snyk 2026-02-05, " +
      "`https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/`).",
  },
  {
    category: "hardcoded-secret",
    // AWS access key id.
    re: /\bAKIA[0-9A-Z]{16}\b/,
    reason:
      "hardcoded AWS access key (AKIA…) — ToxicSkills Secret detection row (10.9 % of audited " +
      "skills leaked credentials).",
  },
  {
    category: "hardcoded-secret",
    // GitHub fine-grained / classic personal access tokens and app tokens.
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,255}\b/,
    reason:
      "hardcoded GitHub token (`ghp_` / `gho_` / `ghu_` / `ghs_` / `ghr_`) — ToxicSkills Secret " +
      "detection row.",
  },
  {
    category: "hardcoded-secret",
    // OpenAI / Anthropic / generic `sk-` style provider keys (≥ 32 body chars).
    re: /\bsk-(?:ant-|proj-|or-|live-|test-)?[A-Za-z0-9_-]{32,}\b/,
    reason:
      "hardcoded provider API key (OpenAI / Anthropic / OpenRouter `sk-…`) — ToxicSkills Secret " +
      "detection row.",
  },
  {
    category: "hardcoded-secret",
    // Slack bot / user / app / refresh / legacy tokens.
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    reason:
      "hardcoded Slack token (`xoxb-` / `xoxp-` / `xoxa-` / `xoxr-` / `xoxs-`) — ToxicSkills " +
      "Secret detection row.",
  },
  {
    category: "hardcoded-secret",
    // Google API keys.
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
    reason: "hardcoded Google API key (`AIza…`) — ToxicSkills Secret detection row.",
  },
];

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
]);

/** Repo-relative path prefixes that are skipped (use POSIX separators). */
const SKIP_PATH_PREFIXES: readonly string[] = ["tests/", "otherdocs/"];

/** Repo-relative exact paths that are skipped. */
const SKIP_EXACT_PATHS: ReadonlySet<string> = new Set([
  "SECURITY.md",
  "ROADMAP.md",
  "CODE_REVIEW.md",
  "scripts/verify-no-toxic-skills.ts",
  "scripts/verify-no-toxic-skills.js",
]);

/** Decide whether a file's basename is an agent-skill / instruction file. */
export function isAgentSkillFile(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (lower === "skill.md") return true;
  if (lower === "agents.md") return true;
  if (lower === "copilot-instructions.md") return true;
  if (lower.endsWith(".instructions.md")) return true;
  if (lower.endsWith(".prompt.md")) return true;
  if (lower.endsWith(".agent.md")) return true;
  return false;
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

/** Scan a single agent-skill file's text for ToxicSkills CRITICAL patterns. */
export function findToxicSkillPatterns(file: string, source: string): readonly ToxicSkillFinding[] {
  const out: ToxicSkillFinding[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    for (const detector of DETECTORS) {
      if (detector.re.test(raw)) {
        out.push({
          file,
          line: i + 1,
          text: raw.trim(),
          category: detector.category,
          reason: detector.reason,
        });
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
    } else if (entry.isFile() && isAgentSkillFile(entry.name)) {
      yield fileURLToPath(new URL(entry.name, dir));
    }
  }
}

async function main(): Promise<void> {
  let total = 0;
  try {
    await stat(REPO_ROOT);
  } catch (err) {
    console.error(`verify-no-toxic-skills: cannot stat repo root: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  for await (const absolute of walk(REPO_ROOT)) {
    const rel = toPosix(relative(fileURLToPath(REPO_ROOT), absolute));
    if (isSkippedPath(rel)) continue;
    const text = await readFile(absolute, "utf8");
    const findings = findToxicSkillPatterns(rel, text);
    for (const f of findings) {
      console.error(`${f.file}:${f.line}: ToxicSkills ${f.category} (${f.reason}): ${f.text}`);
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-toxic-skills: ${total} ToxicSkills CRITICAL pattern${total === 1 ? "" : "s"} ` +
        "found in shipped agent-skill / instruction files. Daloy publishes SKILL.md guidance into " +
        "every scaffolded project under `.agents/skills/`, so these files inherit the AI agent's " +
        "full shell / file-system / env / network permissions when loaded by Claude Code, Cursor, " +
        "or Copilot. Skills must never instruct an agent to pipe remote scripts into a shell, " +
        "decode base64 payloads, or embed credentials. Snyk Labs ToxicSkills (2026-02-05) found " +
        "13.4 % of ClawHub skills carried at least one CRITICAL issue and 76 carried active " +
        "malicious payloads — this gate keeps Daloy's published skills off that list. See " +
        "`https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/`."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-toxic-skills.ts")) {
  await main();
}
