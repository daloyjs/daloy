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

Copilot CLI runs with a fresh, per-trial `COPILOT_HOME` (your own
instructions, skills, MCP servers and hooks never load), built-in MCP servers
off (it cannot search this repo for the hidden tests),
`COPILOT_DISABLE_LOGIN_SHELL_ENV=1` (otherwise the CLI re-reads your login
shell and re-exports your profile's variables into the agent's commands,
bypassing the harness's environment allowlist), and
`--secret-env-vars` for the GitHub token variables (stripped from the agent's
shell and masked in output). Auth comes from a token; prefer a fine-grained
token limited to Copilot over your full `gh auth token`:

```sh
COPILOT_GITHUB_TOKEN=$(gh auth token) pnpm eval --agent copilot --sandbox-ack --model claude-sonnet-5.5
```

Docker sandbox (recommended for live agents; the agent sees no host files or
credentials, runs as an unprivileged user, and gets only the `-e` variables):

```sh
docker build -f evals/Dockerfile -t daloy-evals .
docker run --rm --cap-drop=ALL --security-opt no-new-privileges \
  -e COPILOT_GITHUB_TOKEN -v "$PWD/evals/results:/home/node/daloy/evals/results" \
  daloy-evals --agent copilot --sandbox-ack --model claude-sonnet-5.5 --trials 5
```

The network stays open (the agent must reach its model API), and the token is
readable by processes in the container, so use a fine-grained token limited
to Copilot.

Offer the DaloyJS docs MCP (opt-in, `copilot` only):

```sh
pnpm eval --agent copilot --sandbox-ack --mcp docs --trials 3
```

`--mcp docs` adds only the public, read-only, keyless docs server
(`https://daloyjs.dev/mcp`, the one templates put in `.vscode/mcp.json`, which
Copilot CLI does not read). The default `--mcp none` matches every run made
before the option existed. GitHub's built-in MCP servers stay off in both
modes, because they can search this repository's hidden tests. `eval:compare`
refuses to compare runs with different MCP modes unless you pass
`--allow-mismatch`, which is exactly what you do when the MCP mode is the
thing you are measuring:

```sh
pnpm eval:compare sonnet-mcp-none.json sonnet-mcp-docs.json --allow-mismatch
```

Other live agents (in an isolated container or VM only):

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

Regrade saved runs after a grader fix, without paying for new agent runs:

```sh
pnpm eval:regrade evals/results/<run>.json   # writes <run>.regraded.json + .md
```

It replays each trial's stored diff onto a fresh scaffold and runs the current
graders. Grading executes the agent's code, so run it in the Docker sandbox
(`--entrypoint node daloy-evals --import tsx evals/regrade.ts ...`). Trials
whose diff was truncated keep their original grades and are listed under
`regrade.skipped`.

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
├── reports/           committed summaries and charts of notable runs (raw results stay in results/)
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
- **Pattern graders match calls, not names.** `timingSafeEqual\s*\(` and not
  `timingSafeEqual`: an import line alone must not satisfy "uses a
  constant-time compare" (calibration caught exactly that).
- **Every task needs a reference, at least one valid alternative, and at
  least one unsafe variant**, and `pnpm eval:calibrate` must pass.
  Calibration is what makes a score trustworthy. Alternatives guard against
  false failures (a grader that only accepts the author's solution shape).
  Calibration and the live runs have caught eight grader bugs so far: hidden
  tests that expected 400 where DaloyJS answers 422; a guardrail rule that
  ignored Zod 4's `z.strictObject()`; a `protected-files` rule that failed
  agents for appending a good extra test; a constant-time-compare pattern that
  an import line satisfied; a tenant test that demanded 401 where
  `bearerAuth()` itself answers 403 for a wrong key; and two tests that
  demanded the app boot without a required secret, when refusing to boot is
  also fail-closed; and a guardrail rule that flagged `z.object({}).passthrough()`
  for a webhook's free-form `data` field, the same contract as
  `z.record(z.string(), z.unknown())`. Every one was found by reading the trace of a "failed"
  run that was actually correct.
- **Nothing the agent sees may name the evaluation.** Workspaces live in a
  neutral temp folder, the project is `my-daloy-app`, and the baseline commit
  is "Initial commit". Runs before 16 Nov 2026 (afternoon) used folder names
  like `daloy-eval-guardrail-body-limit`, which one model read as a hint.
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
