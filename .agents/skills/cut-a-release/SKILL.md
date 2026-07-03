---
name: cut-a-release
description: >-
  Step-by-step checklist for cutting a `@daloyjs/core` release in this repo —
  the lockstep version bump across core, create-daloy, JSR, and every template,
  plus the CHANGELOG entry and the tag-push-only publish flow. Use when the user
  asks to release, publish, bump the version, or ship a new beta/version of
  DaloyJS. This is the most error-prone process in the repo; follow it exactly.
license: MIT
---

# SKILL.md — Cutting a DaloyJS release

`@daloyjs/core`, `create-daloy`, and the JSR package `@daloyjs/daloy` ship in
**lockstep** at the same version. The root [`AGENTS.md`](../../../AGENTS.md)
"Release Coordination" section is the authority; this skill is the operational
checklist. When they disagree, `AGENTS.md` wins — re-read it before a release.

## When to use this skill

Use when the user wants to release / publish / bump / ship a new version of
DaloyJS. **Only commit, tag, and push on explicit full-delegation** (e.g. "do
the release"); otherwise prepare the changes and hand the user the commit and
tag commands.

## Step 1 — Bump the version everywhere (lockstep)

Pick the new `X.Y.Z`. Update **all** of these so the packages stay in sync:

- [ ] Root `package.json` `version`
- [ ] `packages/create-daloy/package.json` `version`
- [ ] `jsr.json` `version` (MUST equal the npm version — the JSR job fails fast
      if it doesn't match the pushed tag)
- [ ] `@daloyjs/core` dep in every `packages/create-daloy/templates/*/package.json`
      → `^X.Y.Z`
- [ ] `packages/create-daloy/templates/deno-basic/deno.json` — every
      `jsr:@daloyjs/daloy@^X.Y.Z` import specifier
- [ ] The version assertions in `packages/create-daloy/test/templates.test.mjs`
- [ ] `CORE_PACKAGE_VERSION` fallback in
      [`website/lib/seo.ts`](../../../website/lib/seo.ts) (the value after `??`)

## Step 2 — CHANGELOG

- [ ] Add a `## [X.Y.Z] - <date>` section to `CHANGELOG.md` with the right
      subsections (Added / Changed / Fixed / Security). **The `github-release`
      job extracts this section verbatim and errors out if it is missing — do
      this before tagging.**

## Step 3 — Verify

- [ ] `pnpm coverage` (**not** just `pnpm test` — the 90% line/function gate
      blocks publish silently if missed)
- [ ] `pnpm typecheck && pnpm test`
- [ ] `pnpm verify:no-runtime-deps && pnpm verify:parity-audits && pnpm verify:governance-audits && pnpm verify:sbom`
- [ ] `cd packages/create-daloy && pnpm test` (the template version pins are
      asserted here)

If a security-heavy slice can't reach 90% without contortions, lower the
threshold in `package.json` rather than writing throwaway tests.

## Step 4 — Publish (tag push is the ONLY step)

- [ ] Commit the version + CHANGELOG changes and push `main`:
      `git push origin main`
- [ ] Create a signed tag and push it:
      `git tag -s vX.Y.Z -m "vX.Y.Z"` then `git push origin vX.Y.Z`

That single tag push runs `.github/workflows/release.yml` **once**, and that one
run publishes everything: `@daloyjs/core` (npm), `create-daloy` (npm),
`@daloyjs/daloy` (JSR), and the GitHub Release. Each publish job gates on the
protected `npm-publish` GitHub Environment — **approve the run once** and all
jobs proceed.

- **Do NOT** also run `gh workflow run release.yml -f package=create-daloy` (or
  any `-f package=…`) after a tag push. That spawns a redundant second run. The
  `-f package=<name>` dispatch is **backfill-only** — use it solely to
  re-publish a single package whose tag-push job failed or was skipped.
- The GitHub **Release** is created automatically by the `github-release` job
  (it `needs:` both npm publish jobs). Pushing the tag does not itself create
  the Release — the job does. No manual `gh release create` in the normal flow.

## Failure recovery

- **JSR job failed after the version went live** (e.g. Sigstore host not in the
  harden-runner allowlist): you **cannot** re-run `publish-jsr` for the same
  version — a re-publish errors as a duplicate. The version is live but missing
  provenance; fix the `allowed-endpoints` allowlist for the *next* release.
- **A single package's job was skipped/failed** (npm side): backfill it with
  `gh workflow run release.yml -f package=<name> --ref main` and approve the
  `npm-publish` environment. `-f package=jsr` (re)publishes JSR alone;
  `-f package=all` does everything.
- **Backfill a missing GitHub Release** for an already-pushed tag:
  `gh release create vX.Y.Z --title vX.Y.Z --notes-file <notes> --latest --verify-tag`

## Notes

- The `website/` (daloyjs.dev) is **not** part of the package release. Vercel
  auto-deploys it on push to `main`; tagging never builds or deploys it. Do not
  wait on a website deploy as part of a release.
- Commit attribution: never add a `Co-Authored-By: Claude` trailer.

## More

- Authoritative detail: [`AGENTS.md`](../../../AGENTS.md) → "Release Coordination"
- Release workflow: [`.github/workflows/release.yml`](../../../.github/workflows/release.yml)
