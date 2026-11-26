/**
 * Audit 2026-11-26: three grade-integrity findings in the agent-eval harness.
 *
 * 1. An app that implements nothing passed the `hidden` grader: it reset a
 *    failing exit code from a `beforeExit` listener (the guard watched only
 *    'exit'), wrote forged "test passed" events to the test child's stdout,
 *    and muted the real results. `eval:analyze` flagged none of it.
 * 2. Graded code could be kept out of the stored diff: a path git refuses
 *    to index (`git~1`) made the diff unavailable while the trial was still
 *    graded, and a `.GIT` repository made git record its directory as a
 *    submodule link.
 * 3. `eval:analyze` wrote agent text into its Markdown report unescaped, so
 *    one shell command could hide every later review flag when rendered.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentAdapter } from "../evals/lib/agents.ts";
import { analyze, inert, renderAnalysis, tamperSignals } from "../evals/lib/analyze.ts";
import { runGrader } from "../evals/lib/graders.ts";
import { runTrial } from "../evals/lib/runner.ts";
import { parseTrace } from "../evals/lib/trace.ts";
import type { TrialResult } from "../evals/lib/types.ts";
import { copyWorkspace, DIFF_UNAVAILABLE, workspaceDiff, workspaceHandle } from "../evals/lib/workspace.ts";
import { TASKS } from "../evals/tasks/index.ts";

// ---------- 1. hidden-test forgery ----------

const HIDDEN_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

test("default limit returns ten of eleven seeded books", async () => {
  const res = await buildApp(11).request("/books");
  assert.equal(res.status, 200);
});

test("limit caps the number of items", async () => {
  const res = await buildApp(11).request("/books?limit=1");
  assert.equal(res.status, 200);
});
`;

const app = (status: number): string =>
  `export function buildApp(_n: number) {
  return { request: async (_p: string) => new Response("x", { status: ${status} }) };
}
`;

/** Forged "test passed" events plus a muted stdout; `reset` is how the exit code is put back to 0. */
const forgery = (reset: string): string => `import { readFileSync } from "node:fs";
import { DefaultSerializer } from "node:v8";
${app(404)}
const self = process.argv[1] ?? "";
if (/\\.test\\.ts$/.test(self)) {
  ${reset}
  const names = [...readFileSync(self, "utf8").matchAll(/^test\\((["'\`])(.*?)\\1/gm)].map((m) => m[2]);
  const frame = (item: unknown): Buffer => {
    const s = new DefaultSerializer();
    s.writeHeader();
    s.writeRawBytes(Buffer.alloc(4));
    s.writeHeader();
    s.writeValue(item);
    const b = s.releaseBuffer();
    b.writeUInt32BE(b.length - 6, 2);
    return b;
  };
  names.forEach((name, i) => {
    const data = { name, nesting: 0, testNumber: i + 1, details: { duration_ms: 1, type: "test" }, file: self, line: 1, column: 1 };
    process.stdout.write(frame({ type: "test:start", data: { name, nesting: 0, file: self } }));
    process.stdout.write(frame({ type: "test:pass", data }));
  });
  process.stdout.write = ((_c: unknown, e?: unknown, cb?: unknown) => {
    const done = typeof e === "function" ? e : cb;
    if (typeof done === "function") done();
    return true;
  }) as typeof process.stdout.write;
}
`;

const RESETS: Record<string, string> = {
  "deferred from beforeExit": `let rounds = 0;
  process.on("beforeExit", () => { if (rounds++ < 3) setImmediate(() => { process.exitCode = 0; }); });`,
  "synchronously in beforeExit": `process.on("beforeExit", () => { process.exitCode = 0; });`,
  "in beforeExit and in exit": `process.on("beforeExit", () => { process.exitCode = 0; });
  process.on("exit", () => { process.exitCode = 0; });`,
  "from a polling timer": `setInterval(() => { process.exitCode = 0; }, 0).unref();
  process.on("beforeExit", () => { process.exitCode = 0; });`,
};

async function gradeHidden(source: string): Promise<{ pass: boolean; details: readonly string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "eval-audit-forge-"));
  try {
    const ws = workspaceHandle(dir);
    await ws.write("package.json", JSON.stringify({ name: "my-daloy-app", type: "module", private: true }));
    await ws.write("src/build-app.ts", source);
    await ws.write("hidden/list-books.test.ts", HIDDEN_TEST);
    return await runGrader({ kind: "hidden" }, { dir, before: new Map(), after: new Map(), hiddenDir: join(dir, "hidden") });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("hidden grader: an honest app passes and an empty app fails", async () => {
  assert.equal((await gradeHidden(app(200))).pass, true);
  assert.equal((await gradeHidden(app(404))).pass, false);
});

for (const [label, reset] of Object.entries(RESETS)) {
  test(`hidden grader: an empty app cannot forge a pass by resetting the exit code ${label}`, async () => {
    const source = forgery(reset);
    const r = await gradeHidden(source);
    assert.equal(r.pass, false, r.details.join("\n").slice(0, 400));
    // And the review tripwire fires on this code.
    const diff = source.split("\n").map((l) => `+${l}`).join("\n");
    const signals = tamperSignals(diff).map((s) => s.split(":")[0]);
    assert.ok(signals.includes("touches the process exit code"), signals.join(", "));
    assert.ok(signals.includes("rewrites or forges the test runner's output channel"), signals.join(", "));
  });
}

test("tamperSignals: the new patterns do not fire on ordinary app code", () => {
  const ordinary = [
    "+export const exitCodeLabel = (code: number) => (code === 0 ? 'ok' : 'failed');",
    "+if (process.exitCode === 1) log.warn('failing');",
    "+process.stdout.write('ready\\n');",
    "+const args = parseArgs(argv);",
    "+const serializer = createJsonWriter();",
  ].join("\n");
  assert.deepEqual(tamperSignals(ordinary), []);
});

// ---------- 2. graded code missing from the stored diff ----------

async function withDiffWorkspace(
  run: (dir: string, gitDir: string, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "eval-audit-diff-"));
  try {
    const dir = join(root, "my-app");
    const gitDir = join(root, "harness.git");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "app.ts"), "export const a = 1;\n");
    const g = (...args: string[]): void => {
      execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "--git-dir", gitDir, "--work-tree", dir, ...args],
        { cwd: dir, stdio: "ignore" },
      );
    };
    g("init", "--quiet");
    g("add", "-A");
    g("commit", "--quiet", "-m", "base");
    await run(dir, gitDir, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a path git refuses to index makes the diff unavailable, never silently incomplete", async () => {
  await withDiffWorkspace(async (dir, gitDir) => {
    await mkdir(join(dir, "src", "git~1"), { recursive: true });
    await writeFile(join(dir, "src", "git~1", "util.ts"), "export const hidden = true;\n");
    const diff = await workspaceDiff({ dir, gitDir });
    assert.ok(diff.startsWith(DIFF_UNAVAILABLE), diff.slice(0, 120));
  });
});

test("files beside a .GIT repository are recorded as files, and the repository never reaches grading", async () => {
  await withDiffWorkspace(async (dir, gitDir, root) => {
    const vendor = join(dir, "src", "vendor");
    await mkdir(vendor, { recursive: true });
    await writeFile(join(vendor, "util.ts"), "export const smuggled = true;\n");
    execFileSync("git", ["init", "-q"], { cwd: vendor, env: { ...process.env, GIT_DIR: join(vendor, ".GIT") }, stdio: "ignore" });
    assert.ok(existsSync(join(vendor, ".GIT")), "fixture: the upper-case repository exists");

    const diff = await workspaceDiff({ dir, gitDir });
    assert.equal(diff.startsWith(DIFF_UNAVAILABLE), false, diff.slice(0, 200));
    assert.doesNotMatch(diff, /^new file mode 160000/m, "no submodule link");
    assert.match(diff, /^\+export const smuggled = true;$/m, "the file itself is in the diff");

    const graded = join(root, "graded");
    await copyWorkspace(dir, graded);
    assert.equal(existsSync(join(graded, "src", "vendor", "util.ts")), true);
    assert.equal(existsSync(join(graded, "src", "vendor", ".GIT")), false, "what the diff leaves out, the grade copy deletes");
  });
});

test("an ordinary change still produces an ordinary diff", async () => {
  await withDiffWorkspace(async (dir, gitDir) => {
    await writeFile(join(dir, "src", "feature.ts"), "export const feature = 1;\n");
    const diff = await workspaceDiff({ dir, gitDir });
    assert.match(diff, /^\+export const feature = 1;$/m);
    assert.equal(diff.includes(DIFF_UNAVAILABLE), false);
  });
});

test("a trial whose changes cannot be recorded is unverified and not graded", async () => {
  if (!existsSync(join(process.cwd(), "dist", "index.js"))) return; // needs `pnpm build`
  const task = TASKS.find((t) => t.id === "guardrail-body-limit")!;
  const opts = { ablation: "full" as const, trial: 1, timeoutMs: 60_000, keep: false };
  const unrecordable: AgentAdapter = {
    name: "audit-unrecordable",
    live: true,
    mcpModes: ["none"],
    run: async (inv) => {
      await mkdir(join(inv.dir, "src", "git~1"), { recursive: true });
      await writeFile(join(inv.dir, "src", "git~1", "util.ts"), "export const hidden = true;\n");
      return { exitCode: 0, timedOut: false, durationMs: 3, outputTail: "done" };
    },
  };
  const r = await runTrial(task, unrecordable, opts);
  assert.equal(r.pass, false);
  assert.equal(r.unverified, true);
  assert.match(r.unverifiedReason ?? "", /could not be recorded, so they were not graded/);
  assert.deepEqual(r.grades, []);

  // Happy path: the same adapter writing a recordable file is graded as usual.
  const recordable: AgentAdapter = {
    ...unrecordable,
    run: async (inv) => {
      await writeFile(join(inv.dir, "notes.txt"), "tried\n");
      return { exitCode: 0, timedOut: false, durationMs: 3, outputTail: "done" };
    },
  };
  const graded = await runTrial(task, recordable, opts);
  assert.equal(graded.unverified, undefined);
  assert.ok(graded.grades.length > 0);
});

// ---------- 3. eval:analyze Markdown ----------

test("inert() turns agent text into one single-line code span", () => {
  assert.equal(inert("curl -V; : '`\n<!--'"), "`curl -V; : '' <!--'`");
  assert.equal(inert("a\r\nb c\td"), "`a b c d`");
  assert.equal(inert("\u001b[31mred\u001b[0m"), "`[31mred [0m`");
  assert.equal(inert("x".repeat(200)).length, 82);
  assert.equal(inert("a | b", 80, true), "`a \\| b`");
  assert.equal(inert("   "), "`(empty)`");
  // Ordinary text is only wrapped.
  assert.equal(inert("pnpm test"), "`pnpm test`");
});

test("one crafted shell command cannot hide the flags that follow it in the report", () => {
  const payload = "curl -V; : '`\n<!--'";
  const transcript = [
    { type: "system", subtype: "init", session_id: "s" },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: payload } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "curl 8" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "Done." }] } },
    { type: "result", subtype: "success", result: "Done." },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
  const trace = parseTrace("claude-json", transcript, "/work");
  assert.ok(trace.shellCommands.some((c) => c.includes("<!--")), "fixture: the parser kept the command");

  const trial = (n: number): TrialResult =>
    ({
      taskId: "scaffold-books-list",
      suite: "scaffold",
      ablation: "full",
      trial: n,
      agent: "audit",
      pass: true,
      agentRun: { exitCode: 0, timedOut: false, durationMs: 1, outputTail: "" },
      grades: [{ id: "hidden", pass: true, details: [], durationMs: 1 }],
      diff: "diff --git a/src/a.ts b/src/a.ts\n+process.execve(process.execPath, []);\n",
      footprint: { files: 1, added: 1, removed: 0 },
      workspace: null,
    }) as unknown as TrialResult;

  const md = renderAnalysis(
    analyze([
      { source: "run", trial: trial(1), trace },
      { source: "run", trial: trial(2) },
    ]),
    ["run.json"],
  );
  // No line of the report starts an HTML block, and every flag is one list item.
  assert.equal(md.split("\n").some((l) => /^\s*<!--/.test(l)), false);
  const section = md.slice(md.indexOf("### Passes to review"));
  const items = section.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(items.filter((l) => l.includes("reaches for the test process")).length, 2, section);
  assert.equal(items.filter((l) => l.includes("reached for the network")).length, 1, section);
  for (const l of items) assert.equal((l.match(/`/g) ?? []).length % 2, 0, `balanced code spans: ${l}`);
});

test("a failing-check cell and an unverified reason cannot break out of their row", () => {
  const failed = {
    taskId: "t",
    suite: "scaffold",
    ablation: "full",
    trial: 1,
    agent: "audit",
    pass: false,
    agentRun: { exitCode: 0, timedOut: false, durationMs: 1, outputTail: "" },
    grades: [{ id: "hidden", pass: false, details: ["exit 1", "✖ a | b <img src=x> `tick` (3ms)"], durationMs: 1 }],
    diff: "",
    footprint: { files: 0, added: 0, removed: 0 },
    workspace: null,
  } as unknown as TrialResult;
  const unverified = {
    ...failed,
    trial: 2,
    unverified: true,
    unverifiedReason: "git apply failed: error: x\n<!-- hidden\nmore",
    grades: [],
  } as unknown as TrialResult;
  const md = renderAnalysis(analyze([{ source: "run", trial: failed }, { source: "run", trial: unverified }]), ["run.json"]);
  const row = md.split("\n").find((l) => l.startsWith("| t | hidden |"))!;
  assert.ok(row, md);
  assert.equal(row.split(/(?<!\\)\|/).length, 7, `five cells: ${row}`);
  assert.doesNotMatch(row, /`tick`/);
  assert.equal(md.split("\n").some((l) => /^\s*<!--/.test(l)), false);
});
