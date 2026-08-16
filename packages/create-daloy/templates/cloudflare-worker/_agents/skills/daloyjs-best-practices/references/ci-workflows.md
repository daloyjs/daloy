# CI and workflows (`--with-ci` scaffolds)

**Read this file as reference** when editing `.github/`, Dependabot, or a
`--with-ci` workflow. Skip it unless the task touches CI.

If this project was scaffolded with `--with-ci`, `.github/` holds a hardened
GitHub Actions bundle alongside `CODEOWNERS`, `SECURITY.md`, and the
`verify:lockfile` / `verify:runtime-eol` scripts wired into `package.json`.
Those files carry the same weight as the secure defaults in `SKILL.md` — an
agent asked to "make CI pass" must not soften them.

- Keep every `uses:` pinned to a full commit SHA with its version comment. Never move an action to a tag or a branch, and never add an unpinned one.
- Keep `permissions: {}` at the top of each workflow and grant scopes per job. If a step needs more, give that one job the narrowest scope that works — never widen the workflow default.
- Keep `persist-credentials: false` on `actions/checkout` and keep package-manager caching off; a shared cache can bridge fork PRs into trusted branches.
- Keep installs running with lifecycle scripts disabled (`--ignore-scripts` / `npm_config_ignore_scripts`).
- `verify:lockfile`, `verify:runtime-eol`, the audit steps, the contract check, and the scanners are gates. When one fails, fix the finding — do not delete the step, add `continue-on-error`, or lower a severity threshold to go green.
- Keep `cooldown` in `.github/dependabot.yml` aligned with `minimum-release-age` in `.npmrc`. They are one 24h supply-chain policy expressed to two different tools; changing one alone silently defeats it.
- `dast.yml` boots this template's own start command. If you change how the app starts, update that workflow to match or the weekly scan will fail.
- Read `SECURITY.md` before deleting a workflow. On a private repository without GitHub Advanced Security some of them are _expected_ to be removed, and it lists exactly which.
