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
(gitignored): one JSON file with every trial, its grades and the agent's diff,
plus a Markdown summary.

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
6. Graders run: `typecheck`, `tests`, `hidden` (copied in only now),
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
- **Every task needs a reference and at least one unsafe variant**, and
  `pnpm eval:calibrate` must pass. Calibration is what makes a score
  trustworthy. It already caught one wrong assumption while the harness was
  built: DaloyJS answers validation failures with 422, not 400.
- **Live agents run only in a sandbox** (`--sandbox-ack`). The harness strips
  the environment to an allowlist, but an agent with shell access can still
  read the machine's files.
- Grow the task set from real agent failures.
