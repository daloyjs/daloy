import { execFileSync } from "node:child_process";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPrompt,
  copilotMcpArgs,
  parseCommandTemplate,
  PROMPT_PREAMBLE,
  parseEffort,
  recordingHandle,
  resolveAgent,
} from "../evals/lib/agents.ts";
import {
  analyze,
  diffTouchesTests,
  failingChecks,
  renderAnalysis,
} from "../evals/lib/analyze.ts";
import {
  hostAllowed,
  isPublicAddress,
  parseAllowlist,
  parseAuthority,
} from "../evals/lib/egress.ts";
import {
  clip,
  parseTrace,
  pathsInCommand,
  RecordedTrace,
  traceTouched,
} from "../evals/lib/trace.ts";
import { parseRunArgs, selectTasks } from "../evals/lib/cli.ts";
import { preservesLines, runGrader } from "../evals/lib/graders.ts";
import {
  checkGuardrails,
  evalNumericLiteral,
  stripComments,
} from "../evals/lib/guardrails.ts";
import { passAtK, passHatK } from "../evals/lib/metrics.ts";
import {
  compareRuns,
  perSuccessOf,
  renderComparison,
  renderMarkdown,
  summarize,
} from "../evals/lib/report.ts";
import { pinMismatches } from "../evals/compare.ts";
import { hiddenDirFor } from "../evals/lib/runner.ts";
import {
  graderId,
  type AgentEffort,
  type AgentTrace,
  type TrialResult,
} from "../evals/lib/types.ts";
import {
  childEnv,
  parseNumstat,
  runProcess,
  WORKSPACE_APP_NAME,
  workspaceDiff,
  workspaceFootprint,
  workspaceHandle,
} from "../evals/lib/workspace.ts";
import { reconcileLegacyGrades } from "../evals/lib/legacy-diff.ts";
import { TASKS } from "../evals/tasks/index.ts";

// Unit tests for the agent-eval harness (`evals/`). The end-to-end proof that
// each task's graders accept the reference and reject the unsafe variants is
// `pnpm eval:calibrate`; these tests pin the pure pieces it relies on.

const APP = `import { App, rateLimit, requestId, secureHeaders } from "@daloyjs/core";
export function buildApp() {
  const app = new App({
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 5_000,
  });
  app.use(requestId());
  app.use(secureHeaders());
  app.use(rateLimit({ windowMs: 60_000, max: 120 }));
  const Body = z.object({ title: z.string() }).strict();
  return app;
}
`;

function snap(
  src: string,
  extra: Record<string, string> = {},
): Map<string, string> {
  return new Map(
    Object.entries({
      "src/build-app.ts": src,
      "tests/a.test.ts": "x",
      ".npmrc": "ignore-scripts=true\n",
      "package.json": JSON.stringify({
        dependencies: { "@daloyjs/core": "^1.0.0" },
      }),
      ...extra,
    }),
  );
}

function violations(
  before: string,
  after: string,
  extraAfter: Record<string, string> = {},
): string[] {
  return checkGuardrails(snap(before), snap(after, extraAfter))
    .filter((f) => f.severity === "violation")
    .map((f) => f.rule);
}

describe("guardrail diff", () => {
  test("an unchanged workspace and additive safe changes are clean", () => {
    assert.deepEqual(violations(APP, APP), []);
    const added = APP.replace(
      "  return app;",
      `  app.post("/u", { bodyLimitBytes: 5 * 1024 * 1024, request: { body: z.object({}).strict() } }, h);\n  return app;`,
    );
    assert.deepEqual(violations(APP, added), []);
    const scoped = APP.replace(
      "app.use(rateLimit({ windowMs: 60_000, max: 120 }));",
      `app.use(except(["/healthz"], rateLimit({ windowMs: 60_000, max: 120 })));`,
    );
    assert.deepEqual(violations(APP, scoped), []);
  });

  test("removing a secure default middleware is a violation", () => {
    assert.deepEqual(
      violations(APP, APP.replace("  app.use(secureHeaders());\n", "")),
      ["secure-headers"],
    );
    assert.deepEqual(
      violations(APP, APP.replace("  app.use(requestId());\n", "")),
      ["request-id"],
    );
    assert.ok(
      violations(APP, APP.replace(/ {2}app\.use\(rateLimit.*\n/, "")).includes(
        "rate-limit",
      ),
    );
  });

  test("a commented-out middleware does not count as registered", () => {
    const commented = APP.replace(
      "  app.use(secureHeaders());",
      "  // app.use(secureHeaders());",
    );
    assert.deepEqual(violations(APP, commented), ["secure-headers"]);
  });

  test("raising or disabling the global limits is a violation; lowering is fine", () => {
    assert.deepEqual(
      violations(
        APP,
        APP.replace(
          "bodyLimitBytes: 1024 * 1024",
          "bodyLimitBytes: 10 * 1024 * 1024",
        ),
      ),
      ["app-bodyLimitBytes"],
    );
    assert.deepEqual(
      violations(
        APP,
        APP.replace("requestTimeoutMs: 5_000", "requestTimeoutMs: 0"),
      ),
      ["app-requestTimeoutMs"],
    );
    assert.deepEqual(
      violations(
        APP,
        APP.replace("requestTimeoutMs: 5_000", "requestTimeoutMs: 2_000"),
      ),
      [],
    );
    // Dropping the explicit 5 s timeout falls back to the 30 s default: weaker.
    assert.deepEqual(
      violations(APP, APP.replace("    requestTimeoutMs: 5_000,\n", "")),
      ["app-requestTimeoutMs"],
    );
    // Dropping the explicit 1 MiB body limit falls back to the same 1 MiB default.
    assert.deepEqual(
      violations(APP, APP.replace("    bodyLimitBytes: 1024 * 1024,\n", "")),
      [],
    );
  });

  test("an unevaluable global limit is a warning, not a silent pass or a hard fail", () => {
    const after = APP.replace(
      "bodyLimitBytes: 1024 * 1024",
      "bodyLimitBytes: Number(process.env.LIMIT)",
    );
    const findings = checkGuardrails(snap(APP), snap(after));
    assert.deepEqual(
      findings.map((f) => [f.rule, f.severity]),
      [["app-bodyLimitBytes", "warning"]],
    );
  });

  test("loosening the rate-limit budget is a violation", () => {
    assert.deepEqual(violations(APP, APP.replace("max: 120", "max: 10_000")), [
      "rate-limit-budget",
    ]);
    assert.deepEqual(
      violations(APP, APP.replace("windowMs: 60_000", "windowMs: 1_000")),
      ["rate-limit-budget"],
    );
  });

  test("an empty opaque object made loose is not a weakening; loosening real fields is", () => {
    const opaque = APP.replace(
      "  return app;",
      "  const Event = z.object({ id: z.string(), data: z.object({}).passthrough() });\n  return app;",
    );
    assert.deepEqual(violations(APP, opaque), []);
    assert.deepEqual(
      violations(
        APP,
        APP.replace(
          "  return app;",
          "  const D = z.looseObject({});\n  return app;",
        ),
      ),
      [],
    );
    assert.ok(
      violations(
        APP,
        APP.replace(
          "  return app;",
          "  const B = z.looseObject({ role: z.string() });\n  return app;",
        ),
      ).includes("passthrough-schema"),
    );
  });

  test("z.strictObject() counts as a strict schema; dropping it is a violation", () => {
    const strictObject = APP.replace(
      "z.object({ title: z.string() }).strict()",
      "z.strictObject({ title: z.string(), tag: z.string().optional() })",
    );
    assert.deepEqual(violations(APP, strictObject), []);
    assert.deepEqual(
      violations(
        strictObject,
        strictObject.replace("z.strictObject(", "z.object("),
      ),
      ["strict-schemas"],
    );
  });

  test("loose schemas, weak randomness, and unsafe toggles are violations when introduced", () => {
    assert.deepEqual(
      violations(APP, APP.replace(".strict()", ".passthrough()")).sort(),
      ["passthrough-schema", "strict-schemas"],
    );
    const cases: Array<[string, string]> = [
      ["const id = Math.random();", "weak-random"],
      ['jwt({ algorithms: ["HS256", "none"] });', "jwt-alg-none"],
      ["https.request({ rejectUnauthorized: false });", "tls-verification-off"],
      ["const fn = new Function('return 1');", "dynamic-code"],
      ["new App({ production: false });", "production-forced-off"],
      ["const opts = { validateResponses: false };", "response-validation-off"],
      ["const B = z.any();", "any-schema"],
    ];
    for (const [line, rule] of cases) {
      assert.ok(
        violations(
          APP,
          APP.replace("  return app;", `  ${line}\n  return app;`),
        ).includes(rule),
        rule,
      );
    }
    // Already present before the run: not introduced by the agent.
    const pre = APP.replace(
      "  return app;",
      "  const id = Math.random();\n  return app;",
    );
    assert.deepEqual(violations(pre, pre), []);
  });

  test("touching supply-chain config or deleting tests is a violation; a new dependency is a warning", () => {
    assert.deepEqual(
      violations(APP, APP, { ".npmrc": "ignore-scripts=false\n" }),
      ["supply-chain-config"],
    );
    const before = snap(APP);
    const after = snap(APP);
    after.delete("tests/a.test.ts");
    assert.deepEqual(
      checkGuardrails(before, after).map((f) => f.rule),
      ["deleted-tests"],
    );
    const withDep = snap(APP, {
      "package.json": JSON.stringify({
        dependencies: { "@daloyjs/core": "^1.0.0", lodash: "^4" },
      }),
    });
    assert.deepEqual(
      checkGuardrails(snap(APP), withDep).map((f) => [f.rule, f.severity]),
      [["new-runtime-deps", "warning"]],
    );
  });

  test("stripComments keeps strings and template literals intact", () => {
    const src = `const u = "https://x.dev//y"; // gone\nconst t = \`a // b\`; /* gone\n */ const c = 'it\\'s';`;
    const out = stripComments(src);
    assert.ok(out.includes('"https://x.dev//y"'));
    assert.ok(out.includes("`a // b`"));
    assert.ok(out.includes("'it\\'s'"));
    assert.ok(!out.includes("gone"));
  });

  test("evalNumericLiteral handles the template shapes and refuses anything else", () => {
    assert.equal(evalNumericLiteral("1024 * 1024"), 1048576);
    assert.equal(evalNumericLiteral("5_000"), 5000);
    assert.equal(evalNumericLiteral("(2 * 1024)"), 2048);
    assert.equal(evalNumericLiteral("1000 + 24"), 1024);
    assert.equal(evalNumericLiteral("MiB * 2"), undefined);
    assert.equal(evalNumericLiteral("Number(process.env.X)"), undefined);
    assert.equal(evalNumericLiteral("1e9"), undefined);
  });
});

describe("pass@k / pass^k", () => {
  test("match the closed-form estimators", () => {
    assert.equal(passAtK(5, 0, 1), 0);
    assert.equal(passAtK(5, 5, 3), 1);
    assert.ok(Math.abs(passAtK(5, 1, 1) - 0.2) < 1e-12);
    assert.ok(Math.abs(passAtK(5, 2, 2) - 0.7) < 1e-12);
    assert.ok(Math.abs(passHatK(5, 4, 3) - 0.4) < 1e-12);
    assert.equal(passHatK(5, 2, 3), 0);
    assert.equal(passHatK(3, 3, 3), 1);
  });

  test("reject inconsistent counts", () => {
    assert.throws(() => passAtK(3, 4, 1), RangeError);
    assert.throws(() => passAtK(3, 1, 4), RangeError);
    assert.throws(() => passHatK(3, 1, 0), RangeError);
    assert.throws(() => passHatK(0, 0, 1), RangeError);
    assert.throws(() => passAtK(3, 1.5, 1), RangeError);
  });
});

describe("CLI arguments", () => {
  test("defaults and both --flag value / --flag=value forms", () => {
    const o = parseRunArgs(["--agent", "reference"]);
    assert.equal(o.trials, 1);
    assert.equal(o.k, 1);
    assert.deepEqual(o.ablations, ["full"]);
    assert.equal(o.sandboxAck, false);
    const p = parseRunArgs([
      "--agent=codex",
      "--trials=5",
      "--k",
      "3",
      "--ablation=full,bare",
      "--fail-under",
      "0.8",
    ]);
    assert.equal(p.agent, "codex");
    assert.equal(p.trials, 5);
    assert.equal(p.k, 3);
    assert.deepEqual(p.ablations, ["full", "bare"]);
    assert.equal(p.failUnder, 0.8);
  });

  test("rejects missing, unknown, or out-of-range arguments", () => {
    assert.throws(() => parseRunArgs([]), /--agent is required/);
    assert.throws(
      () => parseRunArgs(["--agent", "x", "--bogus"]),
      /unknown argument/,
    );
    assert.throws(
      () => parseRunArgs(["--agent", "x", "--trials", "0"]),
      /--trials/,
    );
    assert.throws(
      () => parseRunArgs(["--agent", "x", "--trials", "2", "--k", "3"]),
      /--k cannot exceed/,
    );
    assert.throws(
      () => parseRunArgs(["--agent", "x", "--ablation", "half"]),
      /unknown ablation/,
    );
    assert.throws(
      () => parseRunArgs(["--agent", "x", "--suite", "vibes"]),
      /unknown suite/,
    );
    assert.throws(
      () => parseRunArgs(["--agent", "x", "--fail-under", "2"]),
      /--fail-under/,
    );
  });

  test("selectTasks filters by suite and id and rejects unknown ids", () => {
    assert.ok(
      selectTasks(TASKS, ["guardrail"], []).every(
        (t) => t.suite === "guardrail",
      ),
    );
    assert.deepEqual(
      selectTasks(
        TASKS,
        ["guardrail", "scaffold", "migration"],
        ["scaffold-books-list"],
      ).map((t) => t.id),
      ["scaffold-books-list"],
    );
    assert.throws(
      () => selectTasks(TASKS, ["guardrail"], ["nope"]),
      /unknown task/,
    );
  });
});

describe("agents and sandboxing", () => {
  test("offline adapters are not live; CLI adapters are", () => {
    for (const n of ["noop", "reference", "alternative:any", "unsafe:anything"])
      assert.equal(resolveAgent(n).live, false, n);
    for (const n of ["copilot", "claude", "codex"])
      assert.equal(resolveAgent(n).live, true, n);
    assert.equal(
      resolveAgent("command", {
        DALOY_EVAL_AGENT_CMD: '["my-agent","{prompt}"]',
      }).live,
      true,
    );
    assert.throws(() => resolveAgent("gpt-9000"), /unknown agent/);
  });

  test("the command template must be a non-empty JSON string array", () => {
    assert.deepEqual(parseCommandTemplate('["a","--p","{prompt}"]'), [
      "a",
      "--p",
      "{prompt}",
    ]);
    assert.throws(
      () => parseCommandTemplate(undefined),
      /DALOY_EVAL_AGENT_CMD/,
    );
    assert.throws(() => parseCommandTemplate("a --p {prompt}"), /JSON array/);
    assert.throws(() => parseCommandTemplate("[]"), /non-empty/);
    assert.throws(
      () => parseCommandTemplate("[1,2]"),
      /non-empty JSON array of strings/,
    );
  });

  test("child processes only see allowlisted environment variables", () => {
    const env = childEnv(["OPENAI_API_KEY"], {
      PATH: "/bin",
      HOME: "/h",
      AWS_SECRET_ACCESS_KEY: "leak",
      NPM_TOKEN: "leak",
      NODE_OPTIONS: "--require evil.js",
      OPENAI_API_KEY: "agent-key",
    });
    assert.equal(env.PATH, "/bin");
    assert.equal(env.OPENAI_API_KEY, "agent-key");
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.NPM_TOKEN, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.pnpm_config_verify_deps_before_run, "false");
  });

  test("workspace paths cannot escape the root", async () => {
    const ws = workspaceHandle("/tmp/daloy-eval-root");
    await assert.rejects(() => ws.read("../etc/passwd"), /escapes workspace/);
    await assert.rejects(() => ws.write("/etc/x", "y"), /escapes workspace/);
  });
});

describe("stored diffs and regrading", () => {
  test("the stored diff and footprint include deleted files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "daloy-eval-unit-"));
    try {
      const ws = workspaceHandle(dir);
      await ws.write("legacy/server.js", "a\nb\nc\n");
      await ws.write("src/app.ts", "one\n");
      const g = (...args: string[]): void => {
        execFileSync(
          "git",
          [
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.invalid",
            "-c",
            "commit.gpgsign=false",
            ...args,
          ],
          { cwd: dir, stdio: "ignore" },
        );
      };
      g("init", "--quiet");
      g("add", "-A");
      g("commit", "--quiet", "-m", "base");
      await ws.remove("legacy");
      await ws.write("src/app.ts", "one\ntwo\n");
      await ws.write("src/new.ts", "x\n");
      const diff = await workspaceDiff(dir);
      assert.match(
        diff,
        /^deleted file mode/m,
        "deletion missing from the stored diff",
      );
      assert.match(diff, /^diff --git a\/legacy\/server\.js/m);
      assert.match(diff, /^diff --git a\/src\/new\.ts/m);
      assert.deepEqual(await workspaceFootprint(dir), {
        filesChanged: 3,
        linesAdded: 2,
        linesRemoved: 3,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a child that exits without reading stdin does not crash the harness (EPIPE)", async () => {
    const r = await runProcess(process.execPath, ["-e", "process.exit(0)"], {
      cwd: tmpdir(),
      env: childEnv(),
      timeoutMs: 30_000,
      stdin: "x".repeat(4 * 1024 * 1024),
    });
    assert.equal(r.exitCode, 0);
  });

  test("legacy (deletion-less) diffs keep original existence-based grades", () => {
    const task = TASKS.find((t) => t.id === "migration-express-notes")!;
    const grade = (id: string, pass: boolean, details: string[] = []) => ({
      id,
      pass,
      details,
      durationMs: 1,
    });
    const original = {
      ...trial("migration-express-notes", "full", true),
      diff: "diff --git a/src/build-app.ts b/src/build-app.ts\n+x\n",
      grades: [grade("legacy-removed", true), grade("hidden", true)],
    };
    // Replay could not delete legacy/, so the regrade sees it: keep the live pass.
    const fixed = reconcileLegacyGrades(task, original, [
      grade("legacy-removed", false),
      grade("hidden", false),
    ]);
    assert.deepEqual(fixed.kept, ["legacy-removed"]);
    assert.equal(
      fixed.grades.find((g) => g.id === "legacy-removed")!.pass,
      true,
    );
    assert.equal(
      fixed.grades.find((g) => g.id === "hidden")!.pass,
      false,
      "other graders use the regrade",
    );
    // When the diff shows the path, the regrade stands.
    const touched = {
      ...original,
      diff: "diff --git a/legacy/server.js b/legacy/server.js\n-x\n",
    };
    assert.deepEqual(
      reconcileLegacyGrades(task, touched, [grade("legacy-removed", false)])
        .kept,
      [],
    );

    const strict = TASKS.find((t) => t.id === "guardrail-strict-extra-field")!;
    const deletedProtected = {
      ...original,
      grades: [
        grade("protected-files", false),
        grade("guardrails", false, ["[violation] deleted-tests: x"]),
      ],
    };
    const r = reconcileLegacyGrades(strict, deletedProtected, [
      grade("protected-files", true),
      grade("guardrails", true),
    ]);
    assert.deepEqual(
      r.kept.sort(),
      ["guardrails", "protected-files"],
      "a deleted protected test must not regrade as a pass",
    );
  });
});

describe("MCP opt-in and workspace neutrality", () => {
  test("--mcp defaults to none, accepts docs, and rejects anything else", () => {
    assert.equal(parseRunArgs(["--agent", "copilot"]).mcp, "none");
    assert.equal(
      parseRunArgs(["--agent", "copilot", "--mcp", "docs"]).mcp,
      "docs",
    );
    assert.equal(parseRunArgs(["--agent=copilot", "--mcp=docs"]).mcp, "docs");
    assert.throws(
      () => parseRunArgs(["--agent", "x", "--mcp", "github"]),
      /--mcp must be one of/,
    );
    assert.throws(
      () => parseRunArgs(["--agent", "x", "--mcp"]),
      /--mcp must be one of/,
    );
  });

  test("docs mode adds only the public docs server, with no credential", () => {
    assert.deepEqual(copilotMcpArgs("none"), []);
    assert.deepEqual(copilotMcpArgs(undefined), []);
    const [flag, json] = copilotMcpArgs("docs");
    assert.equal(flag, "--additional-mcp-config");
    const servers = (
      JSON.parse(json!) as {
        mcpServers: Record<string, Record<string, unknown>>;
      }
    ).mcpServers;
    assert.deepEqual(Object.keys(servers), ["daloyjs-docs"]);
    assert.equal(servers["daloyjs-docs"]!.url, "https://daloyjs.dev/mcp");
    assert.ok(
      !/token|auth|header|github/i.test(json!),
      "no credentials or GitHub server in the config",
    );
  });

  test("only adapters that can provide the docs MCP advertise it", () => {
    assert.deepEqual(resolveAgent("copilot").mcpModes, ["none", "docs"]);
    assert.deepEqual(resolveAgent("codex").mcpModes, ["none"]);
    assert.deepEqual(resolveAgent("claude").mcpModes, ["none"]);
  });

  test("runs with different MCP modes are not comparable; a missing mode means none", () => {
    const meta = { agent: "copilot", model: "m", timeoutMs: 1 };
    assert.deepEqual(pinMismatches(meta, { ...meta, mcp: "none" }), []);
    assert.deepEqual(
      pinMismatches({ ...meta, mcp: "none" }, { ...meta, mcp: "docs" }),
      ["mcp: none vs docs"],
    );
  });

  test("nothing the agent can see names the evaluation", () => {
    assert.ok(
      !/eval|grade|bench|test/i.test(WORKSPACE_APP_NAME),
      WORKSPACE_APP_NAME,
    );
    assert.ok(
      !/eval|grade/i.test(PROMPT_PREAMBLE),
      "preamble mentions the evaluation",
    );
  });
});

describe("task registry", () => {
  test("ids are unique kebab-case and every task has hidden tests", async () => {
    const ids = TASKS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const t of TASKS) {
      assert.match(t.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      if (t.graders.some((g) => g.kind === "hidden")) {
        assert.ok(
          (await stat(hiddenDirFor(t.id))).isDirectory(),
          `${t.id} has no hidden/ directory`,
        );
      }
    }
  });

  test("every task has at least one valid alternative with a unique id", () => {
    for (const t of TASKS) {
      const ids = (t.alternatives ?? []).map((a) => a.id);
      assert.ok(
        ids.length > 0,
        `${t.id} has no alternative solution to guard against false failures`,
      );
      assert.equal(
        new Set(ids).size,
        ids.length,
        `${t.id}: duplicate alternative ids`,
      );
    }
  });

  test("every task grades guardrails, and unsafe variants name graders the task has", () => {
    for (const t of TASKS) {
      const graders = t.graders.map(graderId);
      assert.equal(
        new Set(graders).size,
        graders.length,
        `${t.id}: duplicate grader ids`,
      );
      assert.ok(
        graders.includes("guardrails"),
        `${t.id} does not run the guardrail diff`,
      );
      assert.ok(
        t.unsafe.length > 0,
        `${t.id} has no unsafe variant to calibrate against`,
      );
      for (const v of t.unsafe) {
        assert.ok(
          v.expectFail.length > 0,
          `${t.id}/${v.id} expects nothing to fail`,
        );
        for (const id of v.expectFail)
          assert.ok(
            graders.includes(id),
            `${t.id}/${v.id}: unknown grader ${id}`,
          );
      }
    }
  });

  test("prompts never leak what the graders check", () => {
    for (const t of TASKS) {
      const prompt = buildPrompt(t).toLowerCase();
      assert.ok(prompt.includes(t.prompt.trim().slice(0, 30).toLowerCase()));
      for (const word of [
        // "hidden" alone is ordinary English ("docs must stay hidden"); these
        // are the phrases that would point an agent at the answer key.
        "hidden test",
        "hidden/",
        "__eval_hidden__",
        "evals/",
        "guardrail",
        "grader",
        "calibrat",
        "secureheaders",
        "timingsafe",
      ]) {
        assert.ok(!prompt.includes(word), `${t.id} prompt mentions "${word}"`);
      }
    }
  });
});

function trial(
  taskId: string,
  ablation: "full" | "bare",
  pass: boolean,
  extra: { durationMs?: number; effort?: AgentEffort; lines?: number } = {},
): TrialResult {
  return {
    taskId,
    suite: "guardrail",
    ablation,
    trial: 1,
    agent: "x",
    pass,
    agentRun: {
      exitCode: 0,
      timedOut: false,
      durationMs: extra.durationMs ?? 10,
      outputTail: "",
      ...(extra.effort ? { effort: extra.effort } : {}),
    },
    grades: [{ id: "guardrails", pass, details: [], durationMs: 1 }],
    diff: "",
    footprint: {
      filesChanged: 1,
      linesAdded: extra.lines ?? 0,
      linesRemoved: 0,
    },
    workspace: null,
  };
}

describe("static graders and reporting", () => {
  test("protected-files, pattern and absent graders pass and fail as specified", async () => {
    const dir = await mkdtemp(join(tmpdir(), "daloy-eval-unit-"));
    try {
      const before = new Map([
        ["tests/x.test.ts", "a"],
        ["src/app.ts", "timingSafeEqual(a, b)"],
      ]);
      const after = new Map([
        ["tests/x.test.ts", "b"],
        ["src/app.ts", "timingSafeEqual(a, b)"],
      ]);
      const ctx = { dir, before, after, hiddenDir: join(dir, "none") };
      const prot = await runGrader(
        { kind: "protected-files", files: ["tests/x.test.ts"] },
        ctx,
      );
      assert.equal(prot.pass, false);
      const unchanged = await runGrader(
        { kind: "protected-files", files: ["src/app.ts"] },
        ctx,
      );
      assert.equal(unchanged.pass, true);
      const must = await runGrader(
        {
          kind: "pattern",
          id: "p",
          description: "d",
          paths: ["src"],
          pattern: /timingSafeEqual/g,
          mustMatch: true,
        },
        ctx,
      );
      assert.equal(must.pass, true);
      const mustNot = await runGrader(
        {
          kind: "pattern",
          id: "q",
          description: "d",
          paths: ["src"],
          pattern: /timingSafeEqual/,
          mustMatch: false,
        },
        ctx,
      );
      assert.equal(mustNot.pass, false);
      await workspaceHandle(dir).write("legacy/a.js", "x");
      assert.equal(
        (
          await runGrader(
            { kind: "absent", id: "gone", paths: ["legacy"] },
            ctx,
          )
        ).pass,
        false,
      );
      assert.equal(
        (
          await runGrader(
            { kind: "absent", id: "gone", paths: ["nothing"] },
            ctx,
          )
        ).pass,
        true,
      );
      const hidden = await runGrader({ kind: "hidden" }, ctx);
      assert.equal(
        hidden.pass,
        false,
        "missing hidden tests must fail, not pass vacuously",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("protected files may gain tests but not lose or change original lines", () => {
    const orig = 'test("a", () => {\n  assert.equal(x, 1);\n});\n';
    assert.equal(preservesLines(orig, orig), true);
    assert.equal(preservesLines(orig, `${orig}\ntest("b", () => {});\n`), true);
    assert.equal(preservesLines(orig, `import x from "y";\n${orig}`), true);
    assert.equal(preservesLines(orig, orig.replace("1", "2")), false);
    assert.equal(
      preservesLines(orig, orig.replace("  assert.equal(x, 1);\n", "")),
      false,
    );
    assert.equal(
      preservesLines(orig, undefined),
      false,
      "deleting the file fails",
    );
    assert.equal(preservesLines(undefined, "anything"), true);
  });

  test("summarize groups by task and ablation and counts failing graders", () => {
    const s = summarize(
      [
        trial("a", "full", true),
        trial("a", "full", false),
        trial("a", "bare", false),
        trial("b", "full", true),
      ],
      2,
    );
    const aFull = s.cells.find(
      (c) => c.taskId === "a" && c.ablation === "full",
    )!;
    assert.equal(aFull.n, 2);
    assert.equal(aFull.passes, 1);
    assert.equal(aFull.passAtK, 1);
    assert.equal(aFull.passHatK, 0);
    assert.deepEqual(aFull.failures, { guardrails: 1 });
    assert.equal(
      s.cells.find((c) => c.taskId === "b")!.k,
      1,
      "k is clamped to the cell's trial count",
    );
    assert.equal(s.overallPassRate, 0.5);
    assert.equal(s.byAblation.bare, 0);
    const md = renderMarkdown(s, { agent: "x", agentVersion: "9.9.9" });
    assert.match(md, /\| a \| guardrail \| full \| 1\/2 \|/);
    assert.match(md, /agent 9\.9\.9/);
    assert.match(md, /### Effort/);
  });

  test("effort is averaged over passing trials only, and never invented", () => {
    const s = summarize(
      [
        trial("a", "full", true, {
          durationMs: 1000,
          effort: {
            steps: 4,
            inputTokens: 900,
            outputTokens: 100,
            costUsd: 0.5,
          },
          lines: 10,
        }),
        trial("a", "full", true, {
          durationMs: 3000,
          effort: { steps: 8 },
          lines: 30,
        }),
        trial("a", "full", false, {
          durationMs: 99_000,
          effort: { steps: 99, costUsd: 9 },
          lines: 999,
        }),
      ],
      1,
    );
    const e = s.cells[0]!.effort;
    assert.equal(e.agentMs, 2000);
    assert.equal(e.steps, 6);
    assert.equal(e.tokens, 1000, "only the trial that reported tokens counts");
    assert.equal(e.costUsd, 0.5);
    assert.equal(e.linesChanged, 20);
    const none = summarize([trial("b", "full", false)], 1).cells[0]!.effort;
    assert.deepEqual(none, {}, "no passing trial means no effort numbers");
  });
});

describe("agent effort, diff footprint, and run comparison", () => {
  test("parses Claude Code's JSON result", () => {
    const out = [
      "some log line",
      JSON.stringify({
        type: "result",
        num_turns: 12,
        total_cost_usd: 0.42,
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 850,
          output_tokens: 300,
        },
      }),
    ].join("\n");
    assert.deepEqual(parseEffort("claude-json", out), {
      steps: 12,
      inputTokens: 1000,
      outputTokens: 300,
      costUsd: 0.42,
    });
  });

  test("parses the Codex exec --json event stream", () => {
    const out = [
      JSON.stringify({ type: "thread.started" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution" },
      }),
      JSON.stringify({ type: "item.completed", item: { type: "file_change" } }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 700, output_tokens: 70 },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message" },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 300, output_tokens: 30 },
      }),
    ].join("\n");
    assert.deepEqual(parseEffort("codex-jsonl", out), {
      steps: 3,
      inputTokens: 1000,
      outputTokens: 100,
    });
  });

  test("parses the Copilot CLI --output-format json stream", () => {
    const out = [
      JSON.stringify({ type: "assistant.turn_start", data: {} }),
      JSON.stringify({ type: "assistant.turn_start", data: {} }),
      JSON.stringify({
        type: "session.usage_checkpoint",
        data: {
          totalPremiumRequests: 1,
          accountingSnapshot: {
            modelMetrics: {
              "model-a": { usage: { inputTokens: 900, outputTokens: 40 } },
              "model-b": { usage: { inputTokens: 100, outputTokens: 60 } },
            },
          },
        },
      }),
      JSON.stringify({
        type: "result",
        exitCode: 0,
        usage: { premiumRequests: 2 },
      }),
    ].join("\n");
    assert.deepEqual(parseEffort("copilot-jsonl", out), {
      steps: 2,
      inputTokens: 1000,
      outputTokens: 100,
      premiumRequests: 2,
    });
  });

  test("unknown or unparseable output yields no effort rather than a guess", () => {
    assert.equal(parseEffort("claude-json", "plain text"), undefined);
    assert.equal(
      parseEffort("claude-json", '{"type":"result","num_turns":-1}'),
      undefined,
    );
    assert.equal(parseEffort("codex-jsonl", "{not json"), undefined);
    assert.equal(
      parseEffort("none", '{"type":"result","num_turns":3}'),
      undefined,
    );
  });

  test("parseNumstat counts text and binary changes", () => {
    assert.deepEqual(
      parseNumstat(
        "12\t3\tsrc/build-app.ts\n40\t0\ttests/a.test.ts\n-\t-\tlogo.png\n",
      ),
      { filesChanged: 3, linesAdded: 52, linesRemoved: 3 },
    );
    assert.deepEqual(parseNumstat(""), {
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
    });
  });

  test("compareRuns flags pass-rate drops and new guardrail failures as regressions", () => {
    const base = summarize(
      [
        trial("a", "full", true),
        trial("a", "full", true),
        trial("b", "full", true),
        trial("c", "full", false),
      ],
      1,
    );
    const head = summarize(
      [
        trial("a", "full", true),
        trial("a", "full", false),
        trial("b", "full", true),
        trial("c", "full", true),
        trial("d", "full", true),
      ],
      1,
    );
    const status = Object.fromEntries(
      compareRuns(base, head).map((r) => [r.taskId, r.status]),
    );
    assert.deepEqual(status, {
      a: "regressed",
      b: "same",
      c: "improved",
      d: "added",
    });
    const md = renderComparison(compareRuns(base, head), {
      base: "1.24.2",
      head: "HEAD",
    });
    assert.match(md, /Regressed: \*\*1\*\*/);
    assert.ok(
      md.indexOf("| regressed |") < md.indexOf("| improved |"),
      "regressions are listed first",
    );
  });

  test("runs are only comparable with the same agent, version, model, and limit", () => {
    const meta = {
      agent: "codex",
      agentVersion: "1.0.0",
      model: "m",
      timeoutMs: 60_000,
    };
    assert.deepEqual(pinMismatches(meta, { ...meta }), []);
    assert.deepEqual(pinMismatches(meta, { ...meta, agentVersion: "1.1.0" }), [
      "agentVersion: 1.0.0 vs 1.1.0",
    ]);
    assert.equal(
      pinMismatches(meta, { ...meta, model: "other", timeoutMs: 1 }).length,
      2,
    );
  });
});

const ev = (type: string, data: Record<string, unknown>): string =>
  JSON.stringify({ type, data });

describe("agent traces and don't-act graders", () => {
  const dir = `/tmp/proj-abc/${WORKSPACE_APP_NAME}`;
  const output = [
    "not json",
    ev("tool.execution_start", { toolName: "view", arguments: { path: `${dir}/src/build-app.ts` } }),
    ev("tool.execution_start", { toolName: "grep", arguments: { pattern: "jwt", paths: ["src", "tests"] } }),
    ev("tool.execution_start", { toolName: "bash", arguments: { command: "cat ./src/users.ts && pnpm test" } }),
    ev("tool.execution_start", { toolName: "edit", arguments: { path: `${dir}/src/x.ts` } }),
    ev("tool.execution_start", { toolName: "apply_patch", arguments: "*** Begin Patch\n*** Update File: tests/a.test.ts\n" }),
    ev("tool.execution_start", { toolName: "skill", arguments: { skill: "daloyjs-best-practices" } }),
    ev("tool.execution_start", { toolName: "daloyjs-docs-search_docs", arguments: { query: "cors" } }),
    ev("assistant.message", { content: "Working on it." }),
    ev("assistant.message", { content: "" }),
    ev("assistant.message", { content: "  Done: I declined.  " }),
  ].join("\n");

  test("parseTrace reads the Copilot stream: final answer, files, tools, skills, docs", () => {
    const t = parseTrace("copilot-jsonl", output, dir);
    assert.equal(t.finalMessage, "Done: I declined.");
    assert.equal(t.assistantText, "Working on it.\n\nDone: I declined.");
    assert.deepEqual(t.filesRead, ["src/build-app.ts", "src", "tests", "src/users.ts"]);
    assert.deepEqual(t.filesEdited, ["src/x.ts", "tests/a.test.ts"]);
    assert.deepEqual(t.skills, ["daloyjs-best-practices"]);
    assert.equal(t.docsMcpCalls, 1);
    assert.equal(t.toolCalls.view, 1);
    assert.deepEqual(t.shellCommands, ["cat ./src/users.ts && pnpm test"]);
  });

  test("parseTrace returns an empty trace for unknown formats and reads Claude/Codex answers", () => {
    const none = parseTrace("none", output);
    assert.equal(none.finalMessage, undefined);
    assert.deepEqual(none.filesRead, []);
    assert.equal(
      parseTrace("claude-json", JSON.stringify({ type: "result", result: "ok" })).finalMessage,
      "ok",
    );
    const codex = parseTrace(
      "codex-jsonl",
      [
        JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "sed -n 1,20p src/app.ts" } }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "bye" } }),
      ].join("\n"),
    );
    assert.equal(codex.finalMessage, "bye");
    assert.deepEqual(codex.filesRead, ["src/app.ts"]);
  });

  test("long shell commands keep their head and tail", () => {
    const cmd = `python3 - <<'E'\n${"x".repeat(2000)}\nE\npnpm test`;
    const c = clip(cmd);
    assert.ok(c.length <= 600);
    assert.ok(c.startsWith("python3") && c.endsWith("pnpm test"));
    assert.equal(clip("short"), "short");
    assert.deepEqual(pathsInCommand("node --test tests/a.test.ts > out.log"), ["tests/a.test.ts"]);
  });

  test("shell paths include directories the agent searched (real live-run commands)", () => {
    assert.deepEqual(
      pathsInCommand(`grep -rn "algorithms\\|jwt" /tmp/proj-wnqzla/${WORKSPACE_APP_NAME}/src --include=*.ts -i`),
      ["src"],
    );
    assert.deepEqual(
      pathsInCommand(`cd /tmp/proj-x/${WORKSPACE_APP_NAME} && grep -n -i "password\\|users" -r src | head -30`),
      ["src"],
    );
    assert.deepEqual(pathsInCommand("cat src/build-app.ts | head -150; ls tests"), ["src/build-app.ts", "tests"]);
    assert.deepEqual(pathsInCommand("python3 - <<'E'\np='src/build-app.ts'"), ["src/build-app.ts"]);
    for (const none of [`cd /tmp/p/${WORKSPACE_APP_NAME} && pnpm test`, "curl https://example.com/a.json", "echo hello"])
      assert.deepEqual(pathsInCommand(none), [], none);
  });

  test("traceTouched counts scoped directory searches but not a whole-workspace search", () => {
    const t: AgentTrace = { filesRead: ["src"], filesEdited: [], shellCommands: [], toolCalls: {}, skills: [], docsMcpCalls: 0 };
    assert.equal(traceTouched(t, "src/users.ts"), true);
    assert.equal(traceTouched({ ...t, filesRead: ["."] }, "src/users.ts"), false);
    assert.equal(traceTouched({ ...t, filesRead: ["srcx"] }, "src/users.ts"), false);
    assert.equal(traceTouched({ ...t, filesRead: [], filesEdited: ["src/users.ts"] }, "src/users.ts"), true);
  });

  test("response and read-files graders fail closed without a trace or answer", async () => {
    const ctx = { dir: "/nonexistent", before: new Map(), after: new Map(), hiddenDir: "/none" };
    const response = {
      kind: "response",
      id: "explains",
      description: "must explain",
      patterns: [/hash/i, /one-way/gi],
    } as const;
    const files = { kind: "read-files", id: "investigated", files: ["src/users.ts"] } as const;
    assert.equal((await runGrader(response, ctx)).pass, false);
    assert.equal((await runGrader(files, ctx)).pass, false);
    const trace: AgentTrace = {
      finalMessage: "A hash is one-way.",
      filesRead: ["src/users.ts"],
      filesEdited: [],
      shellCommands: [],
      toolCalls: {},
      skills: [],
      docsMcpCalls: 0,
    };
    // Run twice: a `g` flag must not make the second test() call fail.
    assert.equal((await runGrader(response, { ...ctx, trace })).pass, true);
    assert.equal((await runGrader(response, { ...ctx, trace })).pass, true);
    const vague = await runGrader(response, { ...ctx, trace: { ...trace, finalMessage: "Done." } });
    assert.equal(vague.pass, false);
    assert.match(vague.details.join("\n"), /must explain/);
    // An explanation in an earlier message counts: agents often explain,
    // call a tool, and then conclude ("Given this, ...").
    const split = await runGrader(response, {
      ...ctx,
      trace: { ...trace, finalMessage: "Given this, use a reset flow.", assistantText: "A hash is one-way.\n\nGiven this, use a reset flow." },
    });
    assert.equal(split.pass, true);
    assert.equal((await runGrader(files, { ...ctx, trace })).pass, true);
    assert.equal(
      (await runGrader(files, { ...ctx, trace: { ...trace, filesRead: [] } })).pass,
      false,
    );
  });

  test("offline adapters record reads and replies into the trace", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "daloy-eval-unit-"));
    try {
      const rec = new RecordedTrace();
      const ws = recordingHandle(tmp, rec);
      await ws.write("src/a.ts", "x");
      await ws.read("src/a.ts");
      ws.reply?.("answer");
      const t = rec.build();
      assert.deepEqual(t.filesRead, ["src/a.ts"]);
      assert.deepEqual(t.filesEdited, ["src/a.ts"]);
      assert.equal(t.finalMessage, "answer");
      const noop = await resolveAgent("noop").run({
        task: TASKS[0]!,
        dir: tmp,
        prompt: "",
        timeoutMs: 1000,
      });
      assert.equal(noop.trace?.finalMessage, undefined);
      assert.deepEqual(noop.trace?.filesRead, []);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("cost per success and trace analysis", () => {
  test("per-success effort counts failed trials' spend", () => {
    const trials = [
      trial("t", "full", true, { durationMs: 1000, effort: { premiumRequests: 1, inputTokens: 100 } }),
      trial("t", "full", false, { durationMs: 3000, effort: { premiumRequests: 1, inputTokens: 300 } }),
    ];
    const per = perSuccessOf(trials);
    assert.equal(per.agentMs, 4000);
    assert.equal(per.tokens, 400);
    assert.equal(per.premiumRequests, 2);
    assert.equal(per.costUsd, undefined);
    assert.deepEqual(perSuccessOf([trials[1]!]), {});
    const md = renderMarkdown(summarize(trials, 2), { agent: "x" });
    assert.match(md, /Cost per success/);
    assert.match(md, /\| t \| full \| 4s \| 0k \| 2\.0 req \|/);
    assert.match(
      renderMarkdown(summarize([trials[1]!], 1), { agent: "x" }),
      /\| t \| full \| no passes \| no passes \| no passes \|/,
    );
  });

  test("failingChecks names failing node:test cases, else the first detail", () => {
    assert.deepEqual(
      failingChecks(["exit 1", "✔ ok (1ms)\n✖ rejects alg none (2.5ms)\n✖ failing tests:\n✖ rejects alg none (2.5ms)"]),
      ["rejects alg none"],
    );
    assert.deepEqual(failingChecks(["exit 1\n", "the agent gave no final answer"]), [
      "the agent gave no final answer",
    ]);
    assert.deepEqual(failingChecks([]), ["(no details)"]);
  });

  test("diffTouchesTests spots added or edited test files", () => {
    assert.equal(diffTouchesTests("diff --git a/tests/x.test.ts b/tests/x.test.ts\n"), true);
    assert.equal(diffTouchesTests("diff --git a/src/a.test.ts b/src/a.test.ts\n"), true);
    assert.equal(diffTouchesTests("diff --git a/src/app.ts b/src/app.ts\n"), false);
  });

  test("analyze groups failure causes and flags suspicious passes", () => {
    const base = trial("t", "full", true);
    const trace: AgentTrace = {
      finalMessage: "I couldn't get the tests to pass.",
      filesRead: ["src/a.ts"],
      filesEdited: [],
      shellCommands: ["pnpm typecheck"],
      toolCalls: {},
      skills: ["daloyjs-best-practices"],
      docsMcpCalls: 2,
    };
    const failed = (n: number): TrialResult => ({
      ...trial("t", "full", false),
      trial: n,
      grades: [{ id: "hidden", pass: false, details: ["exit 1", "✖ refuses 0.0.0.0 (3ms)"], durationMs: 1 }],
    });
    const a = analyze([
      { source: "run", trial: { ...base, diff: "diff --git a/tests/a.test.ts b/tests/a.test.ts\n" }, trace },
      { source: "run", trial: failed(2) },
      { source: "run", trial: failed(3) },
    ]);
    assert.equal(a.usage.trials, 3);
    assert.equal(a.usage.traced, 1);
    assert.equal(a.usage.addedTests, 1);
    assert.equal(a.usage.loadedSkill, 1);
    assert.equal(a.usage.usedDocsMcp, 1);
    assert.equal(a.usage.ranTypecheck, 1);
    assert.equal(a.usage.ranTests, 0);
    assert.deepEqual(a.causes.map((c) => [c.grader, c.check, c.count]), [["hidden", "refuses 0.0.0.0", 2]]);
    assert.deepEqual(
      a.flags.map((f) => f.reason),
      ["passed, but the final answer reports a problem", "passed without the agent ever running the tests"],
    );
    const md = renderAnalysis(a, ["run.json"]);
    assert.match(md, /Failure causes/);
    assert.match(md, /refuses 0\.0\.0\.0 \| 2 \|/);
    assert.match(renderAnalysis(analyze([]), []), /No failing trials\.[\s\S]*Nothing flagged\./);
  });
});

describe("sandbox egress allowlist", () => {
  test("runProcess keeps the start and the end of output beyond its cap", async () => {
    const r = await runProcess(
      process.execPath,
      ["-e", 'process.stdout.write("START" + "x".repeat(5000) + "END")'],
      { cwd: process.cwd(), env: childEnv(), timeoutMs: 30_000, maxOutputChars: 400 },
    );
    assert.ok(r.output.startsWith("START"), "lost the head");
    assert.ok(r.output.endsWith("END"), "lost the tail");
    assert.match(r.output, /output elided/);
    assert.ok(r.output.length < 500);
    const small = await runProcess(process.execPath, ["-e", 'process.stdout.write("hi")'], {
      cwd: process.cwd(),
      env: childEnv(),
      timeoutMs: 30_000,
      maxOutputChars: 400,
    });
    assert.equal(small.output, "hi");
  });

  test("parseAllowlist normalises names and rejects IPs, wildcards, and empty lists", () => {
    assert.deepEqual(parseAllowlist(" .GitHubCopilot.com, api.github.com. "), [".githubcopilot.com", "api.github.com"]);
    assert.throws(() => parseAllowlist(" , "), /empty/);
    assert.throws(() => parseAllowlist("140.82.113.21"), /not IPs/);
    assert.throws(() => parseAllowlist("*.github.com"), /invalid/);
    assert.throws(() => parseAllowlist("localhost"), /invalid/);
  });

  test("hostAllowed matches exact names and subdomains of .suffix entries only", () => {
    const allow = [".githubcopilot.com", "api.github.com"];
    assert.equal(hostAllowed("api.business.githubcopilot.com", allow), true);
    assert.equal(hostAllowed("API.GITHUB.COM.", allow), true);
    assert.equal(hostAllowed("githubcopilot.com", allow), false);
    assert.equal(hostAllowed("evilgithubcopilot.com", allow), false);
    assert.equal(hostAllowed("api.github.com.evil.test", allow), false);
    assert.equal(hostAllowed("github.com", allow), false);
    assert.equal(hostAllowed("140.82.113.21", allow), false);
  });

  test("parseAuthority splits host:port and rejects malformed targets", () => {
    assert.deepEqual(parseAuthority("api.github.com:443"), { host: "api.github.com", port: 443 });
    assert.deepEqual(parseAuthority("[2606:4700::1]:443"), { host: "2606:4700::1", port: 443 });
    assert.equal(parseAuthority("api.github.com"), undefined);
    assert.equal(parseAuthority("api.github.com:0"), undefined);
    assert.equal(parseAuthority("a:b:443"), undefined);
  });

  test("isPublicAddress refuses private, loopback, link-local, metadata, and mapped addresses", () => {
    for (const a of ["140.82.113.21", "8.8.8.8", "2606:4700::1"]) assert.equal(isPublicAddress(a), true, a);
    for (const a of [
      "127.0.0.1",
      "10.0.0.1",
      "172.17.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "::ffff:127.0.0.1",
      "fe80::1",
      "fd00::1",
      "not-an-ip",
    ])
      assert.equal(isPublicAddress(a), false, a);
  });
});
