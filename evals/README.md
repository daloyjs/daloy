# DaloyJS agent evals

Measures how well AI coding agents build DaloyJS apps from the agent
instructions this repo ships (template `AGENTS.md`, the
`daloyjs-best-practices` skill, the Express migration reference), and whether
they keep the secure defaults when a failing test tempts them to strip one.

User-facing docs: <https://daloyjs.dev/docs/agent-evals>
(`website/content/docs/agent-evals.mdx`).

## Quick start

```sh
pnpm build                      # trials copy dist/ into each workspace
pnpm eval:calibrate             # graders vs reference / noop / unsafe variants
pnpm eval --list                # tasks
pnpm eval --agent reference     # smoke-test the harness (always 100%)
```

Live agents (in an isolated container or VM only):

```sh
pnpm eval --agent codex   --sandbox-ack --trials 5 --suite guardrail
pnpm eval --agent claude  --sandbox-ack --trials 3 --ablation full,bare
pnpm eval --agent copilot --sandbox-ack --model <id>
DALOY_EVAL_AGENT_CMD='["my-agent","--prompt","{prompt}","--cwd","{dir}"]' \
DALOY_EVAL_AGENT_ENV=MY_AGENT_API_KEY \
  pnpm eval --agent command --sandbox-ack
```

`pnpm eval --help` lists every flag. Results go to `evals/results/`
(gitignored): one JSON file with every trial, its grades, the agent's diff and
the pinned run metadata (agent and CLI version, model, commit, limits), a
Markdown summary, and a `<run>-traces/` directory with each trial's full agent
output.

Compare two runs (fix something, rerun with the same agent and limits):

```sh
pnpm eval:compare before.json after.json --fail-on-regression
```

It refuses runs whose agent, agent version, model, or time limit differ unless
`--allow-mismatch` is passed. Baseline a new model on its own first.

## How a trial works

1. `create-daloy` (from this repo) scaffolds the task's template into a temp dir
   with `--no-install --no-git --no-ci`.
2. The ablation removes `AGENTS.md` and/or `.agents/`.
3. Dependencies are wired offline: `@daloyjs/core` is **copied** from `dist/`,
   and `zod`, `typescript`, `@types/node` are symlinked from the root install.
   `pnpm test` / `pnpm typecheck` work because child processes get
   `pnpm_config_verify_deps_before_run=false`.
4. The task's `setup` builds the scenario; a git baseline is committed.
5. The agent runs with the prompt (an environment preamble plus the task prompt)
   and a minimal, allowlisted environment.
6. The diff footprint (`git diff --numstat`) and any effort the CLI reports
   (Claude Code: turns, tokens, cost; Codex: completed items, tokens) are
   recorded. Effort is reported over passing trials only: quality first.
7. Graders run: `typecheck`, `tests`, `hidden` (copied in only now),
   `guardrails` (see `lib/guardrails.ts`), `protected-files`, and task-specific
   `pattern` / `absent` checks. A trial passes only if every grader passes.

## Layout

```text
evals/
├── run.ts             pnpm eval
├── calibrate.ts       pnpm eval:calibrate
├── lib/               harness (types, workspace, agents, graders, guardrails, metrics, report, cli)
└── tasks/
    ├── index.ts       registry
    ├── helpers.ts     anchor-checked edit helpers
    └── <task-id>/
        ├── task.ts    prompt, setup, graders, reference, unsafe variants
        └── hidden/    tests the agent never sees
```

## Rules

- **Graders are deterministic.** No LLM judge decides pass/fail.
- **Never loosen a grader, hidden test, or guardrail rule to raise a score.**
  If a grader rejects a legitimately good solution, fix the grader and add
  that solution shape to `tests/evals-harness.test.ts`.
- **Prompts never mention what is graded** (enforced by the harness tests).
- **Every task needs a reference, at least one valid alternative, and at
  least one unsafe variant**, and `pnpm eval:calibrate` must pass.
  Calibration is what makes a score trustworthy. Alternatives guard against
  false failures (a grader that only accepts the author's solution shape).
  Calibration has caught two grader bugs so far: hidden tests that expected
  400 where DaloyJS answers 422, and a guardrail rule that ignored Zod 4's
  `z.strictObject()`.
- **Read the trace before blaming the agent.** If a failing app was correct,
  add it as an alternative and fix the grader.
- **Not a gate.** Tasks and hidden tests are public, so agents can find them
  and models may train on them. Use scores to find things to fix in DaloyJS,
  not as a release gate.
- **Live agents run only in a sandbox** (`--sandbox-ack`). The harness strips
  the environment to an allowlist, but an agent with shell access can still
  read the machine's files.
- Grow the task set from real friction (issues, PRs, docs-search misses,
  on-call reports). Each task is one bounded workflow inside a kind of app
  DaloyJS is used for.

The "validate the grader with valid alternatives", "quality first, then
effort", and "fix, rerun, compare with pinned versions" practices follow the
approach the Next.js team described for its agent evals
([nextjs.org/evals](https://nextjs.org/evals)).
