# CI and workflows (`--with-ci` scaffolds)

**Read this file as reference** when editing `.github/` or a `--with-ci`
workflow. Skip it unless the task touches CI.

If this project was scaffolded with `--with-ci`, `.github/` holds a hardened
GitHub Actions bundle alongside `CODEOWNERS`, `SECURITY.md`, and a
`verify:runtime-eol` task added to `deno.json`. Those files carry the same
weight as the secure defaults in `SKILL.md` — an agent asked to "make CI
pass" must not soften them.

- Keep every `uses:` pinned to a full commit SHA with its version comment. Never move an action to a tag or a branch, and never add an unpinned one.
- Keep `permissions: {}` at the top of each workflow and grant scopes per job. If a step needs more, give that one job the narrowest scope that works — never widen the workflow default.
- Keep `persist-credentials: false` on `actions/checkout` and keep caching off; a shared cache can bridge fork PRs into trusted branches.
- `deno.lock` is committed and CI installs with `deno install --frozen=true`. Deno ships no `audit` command, so the lockfile is this project's integrity anchor: when a dependency changes, update it deliberately with `deno install` and commit the result. Never drop `--frozen` to make CI pass.
- `verify:runtime-eol`, the contract check, and the scanners are gates. When one fails, fix the finding — do not delete the step, add `continue-on-error`, or lower a severity threshold to go green.
- Read `SECURITY.md` before deleting a workflow. On a private repository without GitHub Advanced Security, some of them are _expected_ to be removed, and it lists exactly which.
