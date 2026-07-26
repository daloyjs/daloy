# Contributing to DaloyJS

DaloyJS is **public and MIT-licensed, but contributions-closed**.

The code is public: you can read it, fork it, learn from it, and use it
under the MIT license declared in [package.json](./package.json) and
[README.md](./README.md). What this repository does **not** accept is pull
requests from anyone who is not already an invited maintainer or explicit
repository collaborator. Any uninvited PR is closed automatically by
[.github/workflows/close-external-prs.yml](./.github/workflows/close-external-prs.yml).

## Why

Maintainer time, not code volume, is the bottleneck on a small framework
project. Reviewing a PR responsibly means reading every line, reasoning
about the security model, running the full quality gates documented in
[AGENTS.md](./AGENTS.md) (`pnpm typecheck`, `pnpm coverage` at ≥90% lines
and functions, `pnpm build`, docs and `website/` checks), and committing
to maintain that code indefinitely. The cost of a careless merge is paid
forever; the cost of saying "no" is paid once.

In an environment where it is trivial to generate plausible-looking
patches with an LLM, the ratio of low-signal PRs to high-signal PRs has
shifted enough that an open PR queue is a net negative for this project.
Closing the queue is the honest version of "we will not get to your PR."

This is the same pattern adopted by other small, opinionated projects
(e.g. SQLite, and more recently the Nuxt core team for parts of their
work) and is **not** a statement about the quality of any specific
contributor or change.

## What _is_ open

The following channels are open to everyone and are genuinely useful:

- **Security vulnerabilities**: please follow [SECURITY.md](./SECURITY.md)
  and use GitHub's private vulnerability reporting. Security reports are
  the highest-priority inbound signal.
- **Bug reports**: open a regular Issue with a minimal reproduction.
  A clear repro is often more valuable than a patch, because it lets the
  maintainers fix the root cause rather than the symptom.
- **Feature requests and design discussion**: open an Issue (or a
  Discussion, if enabled). Roadmap items live in [ROADMAP.md](./ROADMAP.md).
- **Documentation issues**: open an Issue describing what is wrong or
  missing on the [website](./website) or in the README.
- **Forks**: you are free to fork, modify, and ship your own variant
  under the MIT terms.

## What is closed

- Pull requests from uninvited accounts. These are closed automatically with
  a comment pointing back to this document.
- Bot pull requests from outside trusted repository automation. Dependabot is
  allowed because it is configured by this repository; other bots are closed
  unless maintainers explicitly add them to the workflow allowlist.
- "Drive-by" doc-typo PRs, dependency bumps, lint-rule reshuffles, and
  similar low-signal changes. File an Issue if a doc is actually wrong;
  Dependabot already handles dependency bumps.

## For invited collaborators

If you have been added to the `daloyjs` org as a member or as an explicit
repository collaborator, the workflow will not close your PRs. Follow the
normal quality gates in [AGENTS.md](./AGENTS.md), the PR template in
[.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md),
and the reviewer checklist in [CODE_REVIEW.md](./CODE_REVIEW.md). The
last document also doubles as the recommended review discipline for
downstream apps built on `@daloyjs/core`.

### Release notes

SBOM generation and verification are part of the release contract.

The relevant commands are:

```bash
pnpm gen:sbom
pnpm verify:sbom
```

You can run them locally before a release if you want a quick preflight, but
they are already enforced automatically:

- [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs both commands on PRs and pushes to `main`.
- [`.github/workflows/release.yml`](./.github/workflows/release.yml) reruns both commands before either publish job can reach npm.

In other words, forgetting to run them locally should not let a bad release through.

To avoid duplicate-version failures on npm, pick one publish path per version:

- the protected GitHub release workflow, or
- a one-off local publish

Do not use both for the same version.
