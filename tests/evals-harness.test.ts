import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPrompt,
  parseCommandTemplate,
  resolveAgent,
} from "../evals/lib/agents.ts";
import { parseRunArgs, selectTasks } from "../evals/lib/cli.ts";
import { runGrader } from "../evals/lib/graders.ts";
import {
  checkGuardrails,
  evalNumericLiteral,
  stripComments,
} from "../evals/lib/guardrails.ts";
import { passAtK, passHatK } from "../evals/lib/metrics.ts";
import { renderMarkdown, summarize } from "../evals/lib/report.ts";
import { hiddenDirFor } from "../evals/lib/runner.ts";
import { graderId, type TrialResult } from "../evals/lib/types.ts";
import { childEnv, workspaceHandle } from "../evals/lib/workspace.ts";
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
    for (const n of ["noop", "reference", "unsafe:anything"])
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
        "hidden",
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

  test("summarize groups by task and ablation and counts failing graders", () => {
    const trial = (
      taskId: string,
      ablation: "full" | "bare",
      pass: boolean,
    ): TrialResult => ({
      taskId,
      suite: "guardrail",
      ablation,
      trial: 1,
      agent: "x",
      pass,
      agentRun: {
        exitCode: 0,
        timedOut: false,
        durationMs: 10,
        outputTail: "",
      },
      grades: [{ id: "guardrails", pass, details: [], durationMs: 1 }],
      diff: "",
      workspace: null,
    });
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
    assert.match(
      renderMarkdown(s, { agent: "x" }),
      /\| a \| guardrail \| full \| 1\/2 \|/,
    );
  });
});
