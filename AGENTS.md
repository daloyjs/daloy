# AGENTS.md

`@daloyjs/core` is a runtime-portable, contract-first TypeScript web framework
with built-in OpenAPI generation, typed-client codegen (Hey API), and
security-first defaults. This repo is a pnpm monorepo containing the framework
(`src/`), the `create-daloy` scaffolder (`packages/create-daloy/`), and the
docs/marketing site (`website/`).

- **Package manager:** pnpm (>= 11). Do not use `npm`/`yarn` here.
- **Runtime:** Node.js >= 24. The framework also ships adapters for Bun, Deno,
  Cloudflare Workers, and Vercel.
- **No runtime dependencies:** `@daloyjs/core` must stay dependency-free
  (`pnpm verify:no-runtime-deps` is the floor).

## Commands

- `pnpm dev` — watch-mode `tsc`
- `pnpm build` — emit `dist/` via `tsconfig.build.json`
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — run the test suite (`node --test` via `tsx`)
- `pnpm coverage` — tests with the 90% line/function gate
- `pnpm gen` — regenerate the OpenAPI spec and typed client
- `pnpm format` — Prettier write
- `cd website && pnpm dev | build | typecheck` — docs site

## Design principles

1. **Best OpenAPI ergonomics**: FastAPI's single-source-of-truth route definitions that generate OpenAPI docs and a client SDK with no extra code.
2. **Vercel / serverless / edge fit**: Hono's web-standard core and multi-runtime adapters that let you run the same app on any platform.
3. **Mature Node ops & docs**: Fastify's encapsulated plugins, structured logs, and graceful shutdown features that make production apps easier to build and maintain.
4. **Modern TS-first DX, Bun OK**: Elysia's end-to-end typed handlers, typed context, and typed client that give you confidence and great DX without needing to write extra types or use codegen.
5. **Best typed client codegen**: Hey API's `pnpm gen` command that generates a fully typed fetch SDK from your OpenAPI spec with zero config and no extra code.
6. **Supply-chain-hardened installs and publishing**: pnpm's security defaults for installs plus a hardened CI/CD pipeline with blocked scripts, release-age cooldowns, SHA-pinned actions, and provenance publishing that make it harder for attackers to compromise your supply chain and give you confidence in the integrity of your dependencies and the software you publish.

## Quality Gates

### Pre-commit checklist (run before every commit)

Both human developers and AI copilots **MUST** run the following commands locally and confirm they pass before staging a commit. Do not commit if any of these fail.

```sh
pnpm typecheck && pnpm test
pnpm verify:no-runtime-deps
pnpm verify:parity-audits
pnpm verify:governance-audits
pnpm verify:sbom
```

If a change touches `website/`, also run `cd website && pnpm typecheck && pnpm build` before committing. The docs/marketing site is **deployed automatically by Vercel** (Git integration: every push to `main` ships a production deploy of [daloyjs.dev](https://daloyjs.dev), PRs get preview deploys), so this local build is a pre-commit verification step only — **not** a deploy. The website is **not** part of the `@daloyjs/core` / `create-daloy` package release (npm + JSR); tagging a release never builds or deploys it, so do not run or wait on a website deploy as part of cutting a release.

### General rules

- After any new feature, bug fix, or refactor, always run `pnpm typecheck` and `pnpm test`
- If a change touches `website`, also run `cd website && pnpm typecheck && pnpm build` (a local verification only — Vercel auto-deploys the site on push to `main`; it is not part of the package release)
- Do not consider the task complete until these checks pass, unless the user explicitly asks not to run them or the environment prevents it
- Every new feature must include automated happy and unhappy path tests that cover the new behavior, including both happy paths and unhappy paths where practical
- Bug fixes should include a regression happy and unhappy path tests when practical
- Refactors must keep existing tests passing and should add happy and unhappy path tests if behavior changes or previously untested behavior becomes important
- Every new feature must include documentation updates that explain how to use the feature, including examples when practical
- Update also the "Status" table in the README to reflect the new capability
- Documentation updates should be clear, concise, and accurate, and should be reviewed for quality along with the code changes
- Code reviews should be thorough and constructive, providing feedback on both the implementation and the tests, and should ensure that all quality gates are met before approving the changes
- Code coverage targets are **90% lines / 90% functions** on the tsx run and **92% branches** on the compiled-JS run (enforced by `pnpm coverage` and `pnpm coverage:branches`; the branch floor is being ratcheted back up from a temporary 90% relaxation toward the former 95%). Any change that adds code should include tests that cover that code, but **do not burn cycles chasing the last few percent on complex security features** — useless coverage of unreachable defensive branches, tsx phantom source-map lines, or signal/shutdown paths that can't be unit-tested is explicitly not worth blocking a release on. If coverage on a hard security task is taking too long, ship the feature and revisit tests later.
- Any new features should be well documenbted in the `website` documentation, and the documentation should be updated to reflect any changes in behavior or new capabilities introduced by the feature
- Making the repo and the app itself secure are top priorities; any change that has security implications must be carefully reviewed for potential vulnerabilities and should include updates to `SECURITY.md` or related documentation when relevant

## Editing the codebase (non-negotiable)

When editing any code in this repo, the following rules are non-negotiable:

- **Never remove or compromise a security feature.** Do not delete, disable, weaken, or bypass any existing security check, guardrail, or secure default to make code compile, make a test pass, or simplify an implementation. If a security control genuinely blocks a legitimate use case, fix the default for everyone (per-route override, narrower scope, configurable knob) and raise it in the PR — never strip it inline. See the secure-by-default guardrails below for the specific controls that must stay intact.
- **Always add TSDoc.** Every new or modified exported function, class, method, type, interface, and public API surface must carry accurate TSDoc comments that explain its purpose, parameters, return value, thrown errors, and any security-relevant behavior. Keep existing TSDoc in sync when you change behavior. (When chasing coverage, keep TSDoc concise — large doc blocks can shift tsx source maps; see the coverage notes above.)
- **Never compromise existing performance.** Do not introduce regressions on hot paths (routing, parsing, serialization, middleware dispatch). Avoid unnecessary allocations, redundant work, or algorithmic complexity increases. If a change could affect performance, validate against `bench/` and keep results at parity or better; call out any measured deltas in the PR.
- **Always document new features in `website/app/docs`.** Every new feature or public API surface must ship with matching documentation under [`website/app/docs/`](website/app/docs) (with usage and examples), plus the docs navigation/search updates required by [`website/AGENTS.md`](website/AGENTS.md). Read `website/AGENTS.md` before editing anything under `website/`, and run `cd website && pnpm typecheck && pnpm build` after docs changes.

## Secure-by-default guardrails (do not weaken these to make a test pass)

DaloyJS ships with strong defaults — body limits, request timeouts, header sanitization, JWT algorithm allowlists, `timingSafeEqual` credential comparisons, prototype-pollution-safe parsers, `fetchGuard()` SSRF defaults, `.strict()`-by-convention schemas, RFC 9457 problem+json with prod-mode redaction, and a 24h release-age + `ignore-scripts` posture on the supply-chain side. The Supabase + Aikido write-up [Secure-by-Default Development](https://www.aikido.dev/blog/supabase-approach-to-secure-by-default-development) captures the failure mode in one line: *"If you tell an AI to make something work, it might remove the very security checks that protect you."*

That risk exists for human contributors and AI coding agents alike. When a test fails or a request is rejected by a security check, the answer is almost never to weaken the check. The framework's posture is:

- Treat **bad defaults as bugs**. If a default actually blocks legitimate behavior, fix the default for everyone (per-route override, narrower scope, configurable knob) rather than removing it inline.
- Never silently delete or weaken: `secureHeaders`, `requestId`, `rateLimit`, `bodyLimitBytes`, `requestTimeoutMs`, `fetchGuard`, `isForbiddenObjectKey`, JWT algorithm allowlists, `timingSafeEqual` credential comparisons, schema `.strict()`, response-body schema validation, `except()` path normalization, prod-mode error redaction, or the `_gitignore` / `_npmrc` defaults in templates.
- Changes to `src/security.ts`, `src/hashing.ts`, `src/jwt.ts`, `src/fetch-guard.ts`, `src/jwk.ts`, the verify-* scripts, or `.github/` workflows must keep the existing CI gates green (`pnpm verify:parity-audits`, `verify:governance-audits`, `verify:runtime-parity-audits`, `verify:routing-hardening-audits`, `verify:secret-comparisons`, `verify:no-remote-exec`, `verify:no-registry-exfiltration`, `verify:no-encoded-payloads`, `verify:no-invisible-unicode`, `verify:no-weak-random`, `verify:no-unsafe-buffer`, `verify:no-leaked-credentials`, `verify:no-vulnerable-sandboxes`, `verify:no-lifecycle-scripts`, `verify:lockfile-sources`, `verify:no-runtime-deps`, `verify:dep-licenses`, `verify:known-dep-names`, `verify:sbom`). These gates exist precisely so an "easy" weakening cannot land silently.
- Every change that touches an auth, header, parsing, or crypto code path ships with an **unhappy-path test** that proves the guard still rejects what it should — not just that the new happy path works.
- Do not add runtime dependencies to `@daloyjs/core`; `verify:no-runtime-deps` is the floor.

If a guardrail blocks a legitimate use case, raise it in the PR description and add a scoped knob — do not delete the guardrail to ship faster.

## Website and Blog Authoring

The marketing/docs site lives in [`website/`](website) and has its own agent guide at [`website/AGENTS.md`](website/AGENTS.md). **Always read it before editing anything under `website/`** — it is the source of truth for:

- Voice and tone rules for new blog posts (author persona, humor, English-only prose, no Tagalog/Norwegian).
- Required stack assumptions for examples (latest Next.js App Router + React 19 + Tailwind v4 + shadcn/ui).
- The mandatory checklist for adding a blog post: create `app/blog/<slug>/page.tsx`, use the **current real date**, add the post to [`website/app/blog/page.tsx`](website/app/blog/page.tsx), and add a matching entry to [`website/app/sitemap.ts`](website/app/sitemap.ts).
- Docs navigation/search files that must be updated when adding or moving doc routes.

If a task involves writing or editing a blog post, treat `website/AGENTS.md` as required reading, not optional context.

## Release Coordination

`@daloyjs/core` and `create-daloy` ship together. Any change that publishes a new `@daloyjs/core` version MUST also publish a matching `create-daloy` so scaffolded projects pin the latest peer.

- When bumping `@daloyjs/core` version in the root `package.json`, also:
  - Bump `packages/create-daloy/package.json` version (typically a minor or patch alongside the core bump)
  - Bump `version` in `jsr.json` (the JSR package `@daloyjs/daloy` is published from the same source — it MUST match the npm version)
  - Update `@daloyjs/core` peer/dependency in every `packages/create-daloy/templates/*/package.json` and `packages/create-daloy/templates/deno-basic/deno.json` to the new core version (use `^X.Y.Z`)
  - Update the matching assertions in `packages/create-daloy/test/templates.test.mjs`
  - Update the `CORE_PACKAGE_VERSION` fallback in `website/lib/seo.ts` (the value after `?? ` — overridable at build time via the `NEXT_PUBLIC_CORE_PACKAGE_VERSION` env var). There is no `website/next.config.mjs`; this fallback is the only place the website hardcodes the core version.
- Run `pnpm coverage` (not just `pnpm test`) before tagging — the 90% line/function gate in CI blocks publish silently if missed. If a security-heavy slice can't reach 90% without contortions, lower the threshold in `package.json` rather than write throwaway tests.
- Publish flow: **pushing the tag `vX.Y.Z` is the only step.** That single push runs `release.yml` once, and that one run publishes everything — `@daloyjs/core` (npm), `create-daloy` (npm), `@daloyjs/daloy` (JSR), and the GitHub Release. The `publish-core`, `publish-create-daloy`, and `publish-jsr` jobs all gate on `github.event_name == 'push'`, so they all fire from the tag. **Do NOT** also run `gh workflow run release.yml -f package=create-daloy` after a tag push — that spawns a second, redundant run (it re-publishes only the companion and otherwise just duplicates the protected-environment approval prompt). The `-f package=<name>` dispatch is **backfill-only**: use it to re-publish a single package when its tag-push job failed or was skipped, never as part of the normal tag flow.
- Every publish job in the tag-push run requires approval on the `npm-publish` GitHub Environment; one approval of the run gates all of them.
- **JSR is published automatically on the tag push too.** The same `vX.Y.Z` tag runs the `publish-jsr` job in `.github/workflows/release.yml`, which publishes the JSR package [`@daloyjs/daloy`](https://jsr.io/@daloyjs/daloy) from the raw `src/*.ts` source (no build/tarball — JSR ships TypeScript) via JSR's GitHub Actions **OIDC** flow (no long-lived JSR token in repo secrets). It runs in the same protected `npm-publish` environment (so it needs the same approval) but is **independent** of the npm and GitHub-Release jobs — a JSR outage never blocks them. Because JSR is the same source as `@daloyjs/core`, it also runs when you dispatch `-f package=@daloyjs/core` or `-f package=all`, **and** there is a dedicated `-f package=jsr` dispatch option to (re)publish JSR on its own — useful for backfilling a missed version: `gh workflow run release.yml -f package=jsr --ref main` (publishes whatever `jsr.json` `version` is on the ref; approve the `npm-publish` environment). The job fails fast if `jsr.json` `version` doesn't match the pushed tag. The `@daloyjs/daloy` JSR package must have GitHub Actions publishing linked to this repo for the OIDC exchange to succeed. `jsr publish` also attaches a **Sigstore provenance attestation**, so the `publish-jsr` harden-runner allowlist must include `fulcio.sigstore.dev`, `rekor.sigstore.dev`, and `tuf-repo-cdn.sigstore.dev` — without them the publish *creates the version and then fails* at the signing step (`Connection refused` to fulcio), leaving JSR showing the new version while the Action goes red. **A failed `publish-jsr` job cannot simply be re-run for the same version** — once the version exists on JSR, a re-publish errors as a duplicate; the version is live (just missing provenance), so fix the allowlist for the *next* release rather than retrying the current one. If JSR's OIDC token endpoint, the Deno binary host, or a Sigstore host moves on a future runner image, widen the `allowed-endpoints` list rather than dropping it to `audit`.
- **GitHub Release is automated, not the tag.** A git tag and a GitHub Release (the "Releases" panel on the repo page, with the `Latest` badge) are different objects — pushing the tag does NOT create the Release. The `github-release` job in `.github/workflows/release.yml` creates it automatically: it runs only on a tag push, `needs:` both npm publish jobs (so it inherits their `npm-publish` environment approval and only fires after both packages ship), extracts the matching `## [X.Y.Z]` section from `CHANGELOG.md` as the body, appends a `compare/<prev>...<tag>` link, and runs `gh release create --latest --verify-tag` (idempotent: it `gh release edit`s an existing Release instead of failing). So **make sure `CHANGELOG.md` has a `## [X.Y.Z]` entry before tagging** — the job errors out if it's missing. No manual `gh release create` step is needed. If you ever need to backfill a Release for an already-pushed tag (e.g. the job predates the tag), run `gh release create vX.Y.Z --title vX.Y.Z --notes-file <notes> --latest --verify-tag`.

