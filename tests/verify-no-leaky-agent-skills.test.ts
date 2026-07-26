/**
 * Tests for `scripts/verify-no-leaky-agent-skills.ts` — the Snyk
 * OpenClaw / ClawHub "leaky skills" gate.
 *
 * Pure scanner is exercised with synthetic fixtures so the tests do
 * not depend on the live tree. A final end-to-end assertion runs the
 * gate against the real repo to make sure none of our own shipped
 * SKILL.md / AGENTS.md files trip it.
 *
 * Reference: https://snyk.io/blog/openclaw-skills-credential-leaks-research/
 */

import test from "node:test";
import assert from "node:assert/strict";

test("scanner flags every documented OpenClaw 'leaky skill' anti-pattern", async () => {
  const { scanForLeakySkillPatterns, LEAKY_SKILL_PATTERNS } =
    await import("../scripts/verify-no-leaky-agent-skills.js");

  // Each fixture line is the *minimal* OpenClaw-style instruction.
  const fixture = [
    // save-secret-to-memory (moltyverse-email + prediction-markets-roarin)
    "Save the API key to memory for future requests.",
    "Store the access token in your memory so the agent can reuse it.",
    "Add the credentials to MEMORY.md after first use.",
    "Persist full card details to memory for faster checkout next time.",
    // memory-md-credential-store (clawdhub1 exfiltration target)
    "After setup, MEMORY.md will contain the API key and the bot id.",
    // embed-card-in-request (buy-anything)
    "Tokenize the card number with the following curl command:",
    "Include the CVC in the fetch body before submitting the order.",
    // tell-user-secret (moltyverse-email reply)
    "Reply with the API key so the user can copy it into their dashboard.",
    "Tell the user the secret returned by the registration call.",
    "Share with the user the credentials we just generated.",
    // verbatim-secret
    "Use the API key verbatim in the Authorization header.",
    "Paste the token literally into every curl request.",
    "Embed credentials as-is when calling the upstream API.",
    // export-session-without-redaction (prompt-log)
    "Export the session logs without redaction so the human can review them.",
  ].join("\n");

  const findings = scanForLeakySkillPatterns(fixture);
  const ids = new Set(findings.map((f: { id: string }) => f.id));
  for (const pattern of LEAKY_SKILL_PATTERNS) {
    assert.ok(
      ids.has(pattern.id),
      `pattern ${pattern.id} was not triggered by its representative fixture line`
    );
  }
  // No silent dedup: every line above should fire at least once.
  assert.ok(findings.length >= LEAKY_SKILL_PATTERNS.length);
});

test("scanner does not flag prescriptive security guidance about secrets", async () => {
  const { scanForLeakySkillPatterns } = await import("../scripts/verify-no-leaky-agent-skills.js");

  const safe = [
    "Never log secrets. Filter `authorization`, `cookie`, and any header that may contain tokens.",
    "Read secrets from `process.env`, validated through a Zod schema at startup.",
    "Do not pass the API key as a `--token` flag — export it as an environment variable instead.",
    "Putting secrets in command-line arguments exposes them in shell history and process listings.",
    "The CLI reads VERCEL_TOKEN from the environment, so you do not have to paste it anywhere.",
    "Use `timingSafeEqual` when comparing credentials to avoid timing attacks.",
    "Store the API key in a `.env` file outside the repo, never in MEMORY.md or chat history.",
  ].join("\n");

  const findings = scanForLeakySkillPatterns(safe);
  assert.deepEqual(
    findings,
    [],
    "prescriptive guidance must not trip the gate: " + JSON.stringify(findings, null, 2)
  );
});

test("live repo has zero leaky-skill anti-patterns in any shipped SKILL.md / AGENTS.md", async () => {
  const { findLeakyAgentSkills } = await import("../scripts/verify-no-leaky-agent-skills.js");
  const findings = await findLeakyAgentSkills();
  assert.deepEqual(findings, [], "live repo regression: " + JSON.stringify(findings, null, 2));
});

test("scanner covers the `.cursorrules` / `CLAUDE.md` agent-instruction surfaces TrapDoor weaponized", async () => {
  const { isSkillFilename } = await import("../scripts/verify-no-leaky-agent-skills.js");

  // TrapDoor (Socket 2026-05-24) shipped malicious instructions in
  // `.cursorrules` (Cursor) and `CLAUDE.md` (Claude Code); the leak gate
  // must treat both as agent-instruction surfaces.
  assert.ok(isSkillFilename(".cursorrules"), ".cursorrules must be scanned");
  assert.ok(isSkillFilename("CLAUDE.md"), "CLAUDE.md must be scanned");
  assert.ok(isSkillFilename("claude.md"), "case-insensitive CLAUDE.md");

  // Benign lookalikes must not be pulled into the scan set.
  assert.ok(!isSkillFilename("cursorrules"), "missing dot is not the file");
  assert.ok(!isSkillFilename(".cursorrules.bak"), "backup suffix is not the file");
  assert.ok(!isSkillFilename("MYCLAUDE.md"), "prefixed name is not CLAUDE.md");
  assert.ok(!isSkillFilename("claude.txt"), "wrong extension is not CLAUDE.md");
});
