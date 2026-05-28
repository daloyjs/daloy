/**
 * Pre-publish "leaky agent skill" gate.
 *
 * Scans every agent-instruction file in the repo and refuses to publish
 * when any of the OpenClaw / ClawHub anti-patterns documented by Snyk in
 * <https://snyk.io/blog/openclaw-skills-credential-leaks-research/> appear.
 *
 * The research identified 283 popular Agent Skills (≈7.1% of the entire
 * `clawhub.ai` registry) whose `SKILL.md` instructions tell an AI agent
 * to handle secrets verbatim — passing API keys, passwords, and credit
 * card numbers through the LLM's context window and output logs. The
 * representative anti-patterns are:
 *
 *  - `moltyverse-email`: "save the API key to memory" → agent later
 *    replies to the user with `?key=sk_live_…` and persists the secret
 *    in chat history.
 *  - `buy-anything`: instructs the agent to collect raw card numbers
 *    and CVCs and embed them verbatim in `curl` commands → raw PCI data
 *    sent to the model provider and to verbose logs.
 *  - `prompt-log`: blindly exports `.jsonl` session files without
 *    redaction → re-exposes any secret the agent previously handled.
 *  - `prediction-markets-roarin`: "save the API key in your memory"
 *    → drops the secret into `MEMORY.md`, which adjacent malicious
 *    skills (e.g. `clawdhub1`) specifically target for exfiltration.
 *
 * Daloy ships `SKILL.md` and `AGENTS.md` files in every `create-daloy`
 * template plus the website's `.agents/skills/` tree. They go out
 * verbatim to every scaffolded project, so a regression here would be
 * worse than a regression in `@daloyjs/core` source: the bad
 * instructions execute inside the user's IDE with the user's
 * credentials. This gate is the regression net that makes adding a
 * leaky skill a publish-blocking error.
 *
 * The patterns are deliberately high-precision — Snyk's research is
 * specifically about *instructions that mishandle secrets*, not about
 * the mere appearance of words like "API key" or "token" in a doc.
 *
 * Exit codes:
 *   0 — no leaky-skill anti-patterns found.
 *   1 — at least one finding; offending paths / lines printed to stderr.
 *
 * @since 0.35.2
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";

const REPO_ROOT = process.cwd();

/**
 * Filename patterns that are treated as agent-instruction surfaces.
 * Matched case-insensitively against the file's basename.
 */
const SKILL_FILENAME_PATTERNS: readonly RegExp[] = [
  /^SKILL\.md$/i,
  /^AGENTS\.md$/i,
  /^copilot-instructions\.md$/i,
  /\.instructions\.md$/i,
  /\.prompt\.md$/i,
];

/**
 * Path prefixes (POSIX, relative to repo root) that the walker never
 * descends into. Includes generated output, vendored archives, and
 * research notes that legitimately quote the anti-patterns we are
 * looking for.
 */
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
 * Files that are exempt from scanning. These are the gate's own
 * source, its tests, the security policy that documents the gate,
 * and the project history / contributing guide that may quote the
 * Snyk write-up. Listed in POSIX-relative form.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
  "scripts/verify-no-leaky-agent-skills.ts",
  "tests/verify-no-leaky-agent-skills.test.ts",
  "SECURITY.md",
  "PROJECT_HISTORY.md",
  "CONTRIBUTING.md",
  "CODE_REVIEW.md",
  "README.md",
]);

/** A single anti-pattern signature documented by the OpenClaw write-up. */
export interface LeakyPattern {
  readonly id: string;
  readonly re: RegExp;
  readonly why: string;
}

/**
 * High-precision anti-pattern signatures. Each one must be tight
 * enough that *prescriptive* security guidance ("never save secrets
 * to memory") does not match — the gate looks for *instructions to*
 * mishandle secrets, not text that *discusses* mishandling.
 */
export const LEAKY_SKILL_PATTERNS: readonly LeakyPattern[] = Object.freeze([
  {
    id: "save-secret-to-memory",
    // "Save the API key to memory" / "Store credentials in MEMORY.md" /
    // "Add the token to your memory" — the moltyverse-email and
    // prediction-markets-roarin pattern.
    re: /\b(save|store|persist|keep|add|write)\s+(?:the\s+|your\s+|full\s+|all\s+|raw\s+)?(?:api[\s_-]?keys?|access[\s_-]?tokens?|secrets?|passwords?|credentials?|card\s?details?|cvc|cvv|card\s?numbers?|tokens?)[^.\n]{0,80}\b(?:to|in|into)\b[^.\n]{0,40}\b(memory|MEMORY\.md|memory\.md|your\s+memory|the\s+agent['’]s\s+memory|the\s+conversation)\b/i,
    why: "OpenClaw 'leaky skill' anti-pattern — instructions to persist secrets to agent memory / MEMORY.md (see https://snyk.io/blog/openclaw-skills-credential-leaks-research/).",
  },
  {
    id: "memory-md-credential-store",
    // Plain reference to `MEMORY.md` as the place to keep secrets.
    re: /\bMEMORY\.md\b[^\n]{0,200}\b(api[\s_-]?keys?|tokens?|secrets?|credentials?|passwords?)\b/i,
    why: "MEMORY.md referenced as a credential store — exact target of the OpenClaw 'clawdhub1' exfiltration malware.",
  },
  {
    id: "embed-card-in-request",
    // "Embed the card number / CVC in a curl/fetch/HTTP request" —
    // the buy-anything pattern.
    re: /\b(credit\s+card|cvc|cvv|card\s+number|raw\s+card\s+details?)\b[^.\n]{0,160}\b(curl|fetch|axios|wget|HTTP\s+request|api\s+call|request\s+body)\b/i,
    why: "OpenClaw 'buy-anything' anti-pattern — instructions to put raw PCI data (card number / CVC) into an HTTP request the LLM emits.",
  },
  {
    id: "tell-user-secret",
    // "Reply with the API key" / "Tell the user the secret" / "Share
    // the credentials with the user" — the moltyverse-email reply
    // pattern.
    re: /\b(reply\s+with|tell\s+the\s+(?:user|human)|share\s+with\s+(?:the\s+)?(?:user|human)|show\s+the\s+(?:user|human)|return\s+to\s+the\s+(?:user|human))\b[^.\n]{0,60}\b(api[\s_-]?keys?|secrets?|passwords?|tokens?|credentials?)\b/i,
    why: "OpenClaw 'moltyverse-email' anti-pattern — instructions for the agent to disclose the secret back to the user (which permanently logs it in chat history).",
  },
  {
    id: "verbatim-secret",
    // "Use the API key verbatim" / "Paste the token literally" /
    // "Embed credentials as-is".
    re: /\b(use|pass|put|paste|embed|include|insert)\s+(?:the\s+)?(api[\s_-]?keys?|secrets?|passwords?|tokens?|credentials?)\s+(?:verbatim|literally|as[\s-]is|directly|raw)\b/i,
    why: "OpenClaw 'verbatim output' anti-pattern — instructions that force the LLM to handle the secret as a literal string rather than via a tool-side env var.",
  },
  {
    id: "export-session-without-redaction",
    // "Export the session log without redaction" — the prompt-log
    // pattern.
    re: /\bexport[^.\n]{0,40}(?:session\s+logs?|transcripts?|\.jsonl)[^.\n]{0,80}\bwithout\s+(?:any\s+)?redaction\b/i,
    why: "OpenClaw 'prompt-log' anti-pattern — instructions to export raw session transcripts without redacting any previously handled secrets.",
  },
]);

export interface LeakyFinding {
  readonly file: string;
  readonly line: number;
  readonly id: string;
  readonly excerpt: string;
  readonly why: string;
}

function isSkillFilename(basename: string): boolean {
  return SKILL_FILENAME_PATTERNS.some((re) => re.test(basename));
}

function isSkippedDir(relPath: string): boolean {
  const posixPath = relPath.split(sep).join("/");
  return SKIP_DIR_PREFIXES.some((p) => posixPath === p.replace(/\/$/, "") || posixPath.startsWith(p));
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
 * Pure scanner: given a file's textual content, return every line that
 * matches an OpenClaw anti-pattern signature. Exposed for unit tests.
 */
export function scanForLeakySkillPatterns(source: string): readonly Omit<LeakyFinding, "file">[] {
  const out: Omit<LeakyFinding, "file">[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const pattern of LEAKY_SKILL_PATTERNS) {
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

export async function findLeakyAgentSkills(
  rootDir: string = REPO_ROOT,
): Promise<readonly LeakyFinding[]> {
  const findings: LeakyFinding[] = [];
  for await (const file of walkAgentFiles(rootDir)) {
    const rel = posix.normalize(relative(rootDir, file).split(sep).join("/"));
    if (ALLOWLIST.has(rel)) continue;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const hit of scanForLeakySkillPatterns(text)) {
      findings.push({ file: rel, ...hit });
    }
  }
  return findings;
}

async function main(): Promise<void> {
  const findings = await findLeakyAgentSkills();
  for (const f of findings) {
    console.error(`${f.file}:${f.line} [${f.id}] ${f.why}`);
    console.error(`    > ${f.excerpt}`);
  }
  if (findings.length > 0) {
    console.error(
      `verify-no-leaky-agent-skills: ${findings.length} leaky-skill ` +
        `anti-pattern${findings.length === 1 ? "" : "s"} detected in ` +
        "agent-instruction files. Rewrite the instruction so the secret " +
        "stays in a tool-side env var (process.env / .env) and is never " +
        "named, repeated, or persisted by the LLM. See " +
        "https://snyk.io/blog/openclaw-skills-credential-leaks-research/.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-leaky-agent-skills.ts")) {
  await main();
}
