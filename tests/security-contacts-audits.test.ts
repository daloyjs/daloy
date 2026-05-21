/**
 * Wave 10 - zero-runtime-dependency batteries-included parity & governance
 * audit regression coverage.
 *
 * Exercises the static gates exported from
 * `scripts/verify-wave10-audits.ts` against the live source tree, and
 * against fixture inputs that simulate each failure mode so the gate
 * cannot silently regress.
 *
 * @since 0.29.0
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  auditSecurityContactsText,
  daysBetween,
  parseSecurityContacts,
  runWave10Audits,
} from "../scripts/verify-wave10-audits.js";

// ---------- live tree: every audit passes on `main` ----------

test("wave10: all static audits pass on the live source tree", async () => {
  const findings = await runWave10Audits();
  const errors = findings.filter((f) => f.level !== "warn");
  if (errors.length > 0) {
    const summary = errors
      .map(
        (f) =>
          `[${f.audit}] ${f.file}${f.line > 0 ? `:${f.line}` : ""} - ${f.text}: ${f.message}`,
      )
      .join("\n");
    assert.fail(`Wave 10 audit gates flagged ${errors.length} error(s):\n${summary}`);
  }
});

// ---------- parseSecurityContacts ----------

test("wave10: parseSecurityContacts extracts active handles and last-exercise date", () => {
  const text = `# Header
<!-- BEGIN ACTIVE -->
- handle: alice
  role: release
- handle: bob_42
<!-- END ACTIVE -->
<!-- last-exercise: 2026-05-20 -->
`;
  const parsed = parseSecurityContacts(text);
  assert.deepEqual(parsed.active, ["alice", "bob_42"]);
  assert.ok(parsed.lastExercise !== null);
  assert.equal(parsed.lastExercise!.toISOString().slice(0, 10), "2026-05-20");
});

test("wave10: parseSecurityContacts returns empty when ACTIVE block is missing", () => {
  const parsed = parseSecurityContacts("# nothing here");
  assert.deepEqual(parsed.active, []);
  assert.equal(parsed.lastExercise, null);
});

test("wave10: parseSecurityContacts ignores bullets outside the ACTIVE block", () => {
  const text = `- handle: zzz_outside_block
<!-- BEGIN ACTIVE -->
- handle: inside
<!-- END ACTIVE -->
- handle: also_outside
`;
  const parsed = parseSecurityContacts(text);
  assert.deepEqual(parsed.active, ["inside"]);
});

test("wave10: parseSecurityContacts rejects normalized invalid dates", () => {
  const parsed = parseSecurityContacts(`<!-- BEGIN ACTIVE -->
- handle: inside
<!-- END ACTIVE -->
<!-- last-exercise: 2026-02-31 -->
`);
  assert.deepEqual(parsed.active, ["inside"]);
  assert.equal(parsed.lastExercise, null);
});

test("wave10: auditSecurityContactsText warns after the quarterly target", () => {
  const findings = auditSecurityContactsText(
    `<!-- BEGIN ACTIVE -->
- handle: inside
<!-- END ACTIVE -->
<!-- last-exercise: 2026-01-01 -->
`,
    new Date(Date.UTC(2026, 3, 15)),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.level, "warn");
  assert.match(findings[0]!.message, /warning threshold/);
});

test("wave10: auditSecurityContactsText rejects future exercise dates", () => {
  const findings = auditSecurityContactsText(
    `<!-- BEGIN ACTIVE -->
- handle: inside
<!-- END ACTIVE -->
<!-- last-exercise: 2026-05-21 -->
`,
    new Date(Date.UTC(2026, 4, 20)),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.level, undefined);
  assert.match(findings[0]!.message, /future/);
});

// ---------- daysBetween ----------

test("wave10: daysBetween returns positive days for later > earlier", () => {
  const earlier = new Date(Date.UTC(2026, 0, 1));
  const later = new Date(Date.UTC(2026, 0, 11));
  assert.equal(daysBetween(later, earlier), 10);
});

test("wave10: daysBetween floors fractional days", () => {
  const earlier = new Date(Date.UTC(2026, 0, 1));
  const later = new Date(earlier.getTime() + 1.5 * 24 * 60 * 60 * 1000);
  assert.equal(daysBetween(later, earlier), 1);
});
