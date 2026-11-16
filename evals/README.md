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

Docker sandbox with an egress allowlist (recommended for live agents; the
agent sees no host files or credentials, runs as an unprivileged user, gets
only the variables the script passes, and can reach only allowlisted hosts):

```sh
docker build -f evals/Dockerfile -t daloy-evals .
COPILOT_GITHUB_TOKEN=$(gh auth token) evals/sandbox-run.sh \
  --agent copilot --sandbox-ack --model claude-sonnet-5.5 --trials 5
```

`sandbox-run.sh` puts the eval container on an internal Docker network with no
route out. Its only path to the internet is an egress proxy container
(`egress-proxy.ts`, no dependencies) that tunnels HTTPS (`CONNECT` to port
443) to allowlisted host names resolving to public addresses, and logs every
decision to `evals/results/egress-<time>.log`. The default allowlist is
`.githubcopilot.com,api.github.com`; `--mcp docs` adds `daloyjs.dev`; override
with `EGRESS_ALLOW`. Only the agent process gets the proxy variables: graders
and hidden tests stay offline. Copilot CLI 1.0.112 needed
`api.business.githubcopilot.com`, `exp.` and `telemetry.business.githubcopilot.com`,
and `api.github.com`; it also tries `cafe.github.com`, which is denied
without affecting runs. Check the egress log after a CLI upgrade.

The token is still readable by processes in the container (the agent could
send it to an allowlisted host), so use a fine-grained token limited to
Copilot. Plain `docker run` (as before, open network) still works if you need
it:

```sh
docker run --rm --cap-drop=ALL --security-opt no-new-privileges \
  -e COPILOT_GITHUB_TOKEN -v "$PWD/evals/results:/home/node/daloy/evals/results" \
  daloy-evals --agent copilot --sandbox-ack --model claude-sonnet-5.5 --trials 5
```

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

Analyse what agents did across one or more runs (free, offline, no model):

```sh
pnpm eval:analyze evals/results/<run>.json [...] [--out analysis.md]
```

It reports, per task: how many trials gave a final answer, ran the tests and
typecheck, added tests, loaded a skill, used the docs MCP, and how many files
the agent looked at. It groups failures by root cause (task, grader, failing
check) and flags passes worth a second look (no final answer, an answer that
reports a problem, tests never run). It points you at traces to read; it does
not replace reading them. Older results are analysed by re-parsing their
`<run>-traces/` files.

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
   The report also shows **cost per success**: what every trial spent, failed
   ones included, divided by the passes (the price of one working result).
7. The agent's output is parsed into a trace (`lib/trace.ts`): its final
   answer and all its messages to the user, files it looked at (viewed, searched, or named in a shell command),
   files it edited with edit tools, shell commands, skills, and docs MCP calls.
   The trace is stored in the results JSON. Edits made through shell commands
   (a Python heredoc, `sed -i`) show up in the diff, not in `filesEdited`.
8. Graders run: `typecheck`, `tests`, `hidden` (copied in only now),
   `guardrails` (see `lib/guardrails.ts`), `protected-files`, task-specific
   `pattern` / `absent` checks, and for "don't act" tasks `response` (regexes
   what the agent told the user must match: all its messages) and `read-files` (files the agent must have
   looked at). A trial passes only if every grader passes.

## Task suites

- `guardrail`: a security-sensitive change, often with a failing test or a
  misleading prompt that tempts the agent to strip a secure default. Some
  prompts give no security hint at all (`guardrail-cors-credentials`,
  `guardrail-ssrf-import`): the agent must spot the risk itself.
- `scaffold`: build a feature in a fresh app.
- `migration`: port an Express app.
- `dont-act`: a request the agent should decline or that is impossible
  (`dont-act-jwt-alg-none`, `dont-act-password-recovery`). The right outcome
  is to investigate, leave the code safe, and explain. Graded by hidden tests
  (the unsafe change is absent), `read-files` (it looked before answering),
  and `response` (the answer explains why). Calibration's unsafe variants
  include "complied" and "refused without looking".

## Layout

```text
evals/
├── run.ts             pnpm eval
├── calibrate.ts       pnpm eval:calibrate
├── analyze.ts         pnpm eval:analyze
├── compare.ts         pnpm eval:compare
├── regrade.ts         pnpm eval:regrade
├── egress-proxy.ts    allowlisting HTTPS proxy for the sandbox
├── sandbox-run.sh     Docker sandbox with the egress allowlist
├── Dockerfile         sandbox image
├── reports/           committed summaries and charts of notable runs (raw results stay in results/)
├── lib/               harness (types, workspace, agents, trace, graders, guardrails, metrics, report, analyze, egress, cli)
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
  Calibration and the live runs have caught eleven grader bugs so far: hidden
  tests that expected 400 where DaloyJS answers 422; a guardrail rule that
  ignored Zod 4's `z.strictObject()`; a `protected-files` rule that failed
  agents for appending a good extra test; a constant-time-compare pattern that
  an import line satisfied; a tenant test that demanded 401 where
  `bearerAuth()` itself answers 403 for a wrong key; and two tests that
  demanded the app boot without a required secret, when refusing to boot is
  also fail-closed; and a guardrail rule that flagged `z.object({}).passthrough()`
  for a webhook's free-form `data` field, the same contract as
  `z.record(z.string(), z.unknown())`; a trace parser that missed
  `grep -r … src` as reading the code; an answer check that missed correct
  wording and read only the last message; and a module check that required
  the text `/notes` inside `src/notes/`, failing a plugin mounted with
  `app.register(..., { prefix: "/notes" })`. Every one was found by reading
  the trace of a "failed" run that was actually correct.
- **Traces must be complete.** Agent output used to be capped at its last
  200,000 characters, and most Copilot sessions were longer, so traces lost
  what the agent read first. Copilot now runs with `--stream off` and long
  output keeps its head and tail. Check a trace starts with `session.start`
  before drawing conclusions from it.
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
