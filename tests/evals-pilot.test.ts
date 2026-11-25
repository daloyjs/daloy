import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AGENT_IMAGE } from "../evals/lib/docker-sandbox.ts";

const fixtures = "evals/pilot/fixtures";
function replay(...paths: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "evals/pilot-report.ts", ...paths],
    { encoding: "utf8" },
  );
}

test("rejects a partial set of books grades before invoking Docker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pilot-invalid-"));
  try {
    const run = JSON.parse(
      await readFile(join(fixtures, "reference.json"), "utf8"),
    );
    run.trials[0].grades.pop();
    const file = join(dir, "invalid.json");
    await writeFile(file, JSON.stringify(run));
    const result = replay(file);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Incomplete or duplicate grade set/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("offline report preserves failures, successes and unverified evidence", async (t) => {
  if (
    !existsSync("evals/pilot/node_modules/deepeval") ||
    spawnSync("docker", ["image", "inspect", AGENT_IMAGE], { stdio: "ignore" })
      .status !== 0
  ) {
    return t.skip(
      "Install the private pilot package and build the Docker eval image",
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "pilot-outcomes-"));
  try {
    const source = JSON.parse(
      await readFile(join(fixtures, "reference.json"), "utf8"),
    );
    const base = source.trials[0];
    const missing = {
      ...base,
      trial: 2,
      pass: false,
      unverified: true,
      grades: [],
      unverifiedReason: "No session",
    };
    const partial = structuredClone(base);
    partial.trial = 3;
    partial.grades[0] = { ...partial.grades[0], pass: false, unverified: true };
    partial.pass = false;
    const timedOut = {
      ...partial,
      agentRun: { ...partial.agentRun, timedOut: true },
    };
    source.trials = [
      base,
      missing,
      timedOut,
      { ...partial, trial: 4, unverified: true },
    ];
    const file = join(dir, "controls.json");
    await writeFile(file, JSON.stringify(source));
    const result = replay(file, join(fixtures, "noop.json"));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 passed, 2 failed, 2 unverified/);
    assert.match(result.stdout, /denominator: 3 verified/);
    assert.match(result.stdout, /NONE.*typecheck.*Unverified/);
    assert.match(result.stdout, /❌.*\*\*route-tests\*\*/);
    assert.match(result.stdout, /Unverified trials[\s\S]+No session/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
