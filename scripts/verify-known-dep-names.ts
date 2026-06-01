/**
 * Slopsquatting / AI-package-hallucination dependency-name allowlist.
 *
 * Closes the residual gap documented in `SECURITY.md` §
 * "Slopsquatting / AI package hallucination (Aikido 2025 pattern)": the
 * window in which an AI coding assistant confidently emits
 * `pnpm add <hallucinated-name>` and an attacker has pre-registered
 * the hallucinated name on npm.
 *
 * The 24h `minimum-release-age=1440` cooldown in `.npmrc` already
 * defends the *time* axis (Aikido / Lasso research shows
 * hallucination-squat packages are typically detected and unpublished
 * inside that window). This gate defends the *name* axis: every
 * top-level dependency name across the workspace
 * (`dependencies` / `devDependencies` / `peerDependencies` /
 * `optionalDependencies`) must appear in {@link ALLOWED_DEP_NAMES}
 * below. Adding a new dep requires a one-line edit to this file in
 * the same PR — the resulting diff is the explicit "did you mean
 * exactly this package name?" review checkpoint that defeats
 * `pnpm add request-promise-native2` even when the cooldown has
 * elapsed and even when the AI agent is otherwise trusted.
 *
 * The list is exact-match and **deliberately small**. Subdependencies
 * resolved into `pnpm-lock.yaml` are NOT checked here — that is the
 * job of `verify:lockfile` (refuses non-registry sources) and
 * `verify:dep-licenses` (refuses non-permissive transitive licenses).
 * The Aikido write-up specifically calls out *direct* installs as
 * the slopsquatting attack vector — an LLM hallucinates a top-level
 * name, the developer / agent runs `pnpm add` against it, and the
 * malicious package becomes a direct dep. Pinning the top-level
 * surface is therefore the proportionate control.
 *
 * Exit code:
 *   0 — every dep name in every scanned `package.json` is on the
 *       allowlist.
 *   1 — at least one dep name is not on the allowlist; the offending
 *       names + the package.json paths that declared them are printed
 *       to stderr along with a slopsquatting-aware remediation hint.
 *
 * @since 0.36.0
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Explicit allowlist of every top-level dependency name declared
 * anywhere in the Daloy workspace (root, `website`,
 * `packages/create-daloy`, every scaffolded template).
 *
 * **To add a new dep:** add the exact name to this Set in the same PR
 * that introduces the dep in any `package.json`. The PR diff on this
 * file is the slopsquatting review checkpoint — reviewers should ask
 * "is this the package I expected, or is it a hallucination /
 * typosquat (`request-promise-native2`, `@types/fastify-helmet`,
 * `huggingface-cli`, etc.)?" before approving.
 *
 * **To remove a dep:** drop the matching `package.json` entry first,
 * then remove the name here.
 */
export const ALLOWED_DEP_NAMES: ReadonlySet<string> = new Set([
  // ----- @daloyjs/core (root package.json) -----
  // Validator peer (only runtime peer).
  "zod",
  // Build / test / generator / lint tooling (devDependencies).
  "@hey-api/openapi-ts",
  "@types/bun",
  "@types/node",
  "fast-check",
  "prettier",
  "tsx",
  "typescript",
  // ----- packages/create-daloy -----
  // (no runtime deps; CLI is zero-dep)
  // ----- website (Next.js docs/marketing site) -----
  "@base-ui/react",
  "@next/third-parties",
  "@phosphor-icons/react",
  "@tailwindcss/postcss",
  "@types/react",
  "@types/react-dom",
  "@vercel/analytics",
  "@vercel/speed-insights",
  "class-variance-authority",
  "clsx",
  "cmdk",
  "eslint",
  "@eslint/eslintrc",
  "eslint-config-next",
  "next",
  "next-themes",
  "postcss",
  "prettier-plugin-tailwindcss",
  "react",
  "react-dom",
  "shadcn",
  "sharp",
  "shiki",
  "tailwind-merge",
  "tailwindcss",
  "tw-animate-css",
  // ----- scaffolded templates (packages/create-daloy/templates/*) -----
  "@daloyjs/core",
  "@cloudflare/workers-types",
  "vercel",
  "wrangler",
]);

/**
 * Package.json files scanned by the gate. Paths are relative to the
 * repo root.
 *
 * `website/.next/**` and `temp_tarball/**` are intentionally excluded:
 * they are build artifacts / extracted publish tarballs, not source.
 */
export const SCANNED_PACKAGE_JSONS: readonly string[] = [
  "package.json",
  "website/package.json",
  "packages/create-daloy/package.json",
  "packages/create-daloy/templates/bun-basic/package.json",
  "packages/create-daloy/templates/cloudflare-worker/package.json",
  "packages/create-daloy/templates/node-basic/package.json",
  "packages/create-daloy/templates/vercel-edge/package.json",
];

interface PackageJsonLike {
  readonly name?: unknown;
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly peerDependencies?: Record<string, unknown>;
  readonly optionalDependencies?: Record<string, unknown>;
}

export interface UnknownDependency {
  readonly source: string;
  readonly block:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies";
  readonly name: string;
}

/**
 * An `"foo": "npm:bar@1.0.0"` dependency-aliasing entry. See
 * {@link findAliasedDependencySpecifiers} for why this is gated.
 *
 * @since 0.36.0
 */
export interface AliasedDependency {
  readonly source: string;
  readonly block:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies";
  readonly name: string;
  readonly specifier: string;
}

const DEP_BLOCKS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Find every declared top-level dependency name in `pkg` that is not
 * present in `allowlist`. Pure / no I/O — safe to call from tests.
 */
export function findUnknownDependencyNames(
  source: string,
  pkg: PackageJsonLike,
  allowlist: ReadonlySet<string> = ALLOWED_DEP_NAMES,
): readonly UnknownDependency[] {
  const out: UnknownDependency[] = [];
  for (const block of DEP_BLOCKS) {
    const map = pkg[block];
    if (!map || typeof map !== "object") continue;
    for (const name of Object.keys(map)) {
      if (!allowlist.has(name)) {
        out.push({ source, block, name });
      }
    }
  }
  return out;
}

/**
 * Find every dependency entry in `pkg` whose specifier uses npm's
 * package-aliasing syntax (`"foo": "npm:bar@1.0.0"`).
 *
 * Why this is gated: npm package aliasing is a documented
 * dependency-confusion vector (Jain & Stathako, Snyk research,
 * *"Exploring extensions of dependency confusion attacks via npm
 * package aliasing"*, Nov 2021). When a published package declares
 * `"x": "npm:y@1.0.0"`, the package's npmjs.com page lists `x` as a
 * dependency — even though `x` does not exist on the registry. An
 * attacker can then publish a malicious `x`, and developers who see
 * the dependency listed on the published page and run
 * `npm install x` get the squatted package. Daloy publishes
 * `@daloyjs/core` and `create-daloy`; we never want the published
 * dependency listing on npmjs.com to advertise a ghost name that
 * downstream users might install by hand. The gate is `npm:`-prefix
 * exact: a future legitimate alias would need to be added to an
 * explicit allowlist (mirror of {@link ALLOWED_DEP_NAMES}) in the
 * same PR that introduces it, providing the deliberate review
 * checkpoint that the threat model requires.
 *
 * Pure / no I/O — safe to call from tests.
 *
 * @since 0.36.0
 */
export function findAliasedDependencySpecifiers(
  source: string,
  pkg: PackageJsonLike,
): readonly AliasedDependency[] {
  const out: AliasedDependency[] = [];
  for (const block of DEP_BLOCKS) {
    const map = pkg[block];
    if (!map || typeof map !== "object") continue;
    for (const [name, spec] of Object.entries(map)) {
      if (typeof spec === "string" && spec.startsWith("npm:")) {
        out.push({ source, block, name, specifier: spec });
      }
    }
  }
  return out;
}

/**
 * A `"foo": "git+https://github.com/x/y.git"` or
 * `"foo": "https://example.com/pkg.tgz"` dependency-specifier entry.
 * See {@link findGitOrUrlDependencySpecifiers} for why this is gated.
 *
 * @since 0.36.0
 */
export interface NonRegistryDependency {
  readonly source: string;
  readonly block:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies";
  readonly name: string;
  readonly specifier: string;
  readonly kind: "git" | "url";
}

/**
 * Match any of npm's documented git-dependency shorthands plus raw
 * `git@host:` SSH URLs. Mirrors `GIT_SOURCE_PATTERN` in
 * `verify-lockfile-sources.ts` but is anchored to the *start* of the
 * specifier (package.json specifiers are bare strings, not lockfile
 * YAML lines, so a leading `specifier:` prefix doesn't apply).
 */
const GIT_SPECIFIER_PATTERN =
  /^(?:github:|gitlab:|bitbucket:|gist:|git\+|git:\/\/|ssh:\/\/git@|git@[a-z0-9._-]+:)/i;

/**
 * Match a plain `http://` or `https://` URL specifier (npm "url" /
 * remote-tarball dependency). These are NOT git shorthands but
 * Socket's `httpDependency` critical alert flags them for the same
 * supply-chain reason: the tarball is not immutable, not signed by
 * the registry, and bypasses the registry's vetting pipeline.
 *
 * Bare `http(s)://…` strings used inside semver/tag specifiers (e.g.
 * `^1.0.0 || https://…`) are not real npm specifiers, so this
 * start-anchored match is safe.
 */
const URL_SPECIFIER_PATTERN = /^https?:\/\//i;

/**
 * Find every dependency entry in `pkg` whose specifier is sourced
 * from a Git repository or a raw HTTP(S) URL instead of the
 * configured npm registry.
 *
 * Why this is gated: Socket's [Git dependency](https://socket.dev/alerts/gitDependency)
 * and [HTTP dependency](https://socket.dev/alerts/httpDependency)
 * critical alerts capture the failure mode in one line — *"the
 * dependency is not inherently immutable. This means the code can be
 * tampered with after it's downloaded, potentially injecting
 * malicious code into your project."* Git tags can be moved, branches
 * change without notice, raw `.tgz` URLs can be silently swapped on
 * the hosting origin, and none of those sources go through the
 * registry's vetting / provenance / integrity-hash pipeline.
 *
 * `pnpm verify:lockfile` already enforces this for resolved entries
 * in `pnpm-lock.yaml`, but template `package.json` files under
 * `packages/create-daloy/templates/*` are never installed in this
 * repo's lockfile — they ship verbatim into every user's scaffold.
 * Scanning the package.json files directly therefore closes the gap
 * between the lockfile gate and the templates we publish.
 *
 * Pure / no I/O — safe to call from tests.
 *
 * @since 0.36.0
 */
export function findGitOrUrlDependencySpecifiers(
  source: string,
  pkg: PackageJsonLike,
): readonly NonRegistryDependency[] {
  const out: NonRegistryDependency[] = [];
  for (const block of DEP_BLOCKS) {
    const map = pkg[block];
    if (!map || typeof map !== "object") continue;
    for (const [name, spec] of Object.entries(map)) {
      if (typeof spec !== "string") continue;
      if (GIT_SPECIFIER_PATTERN.test(spec)) {
        out.push({ source, block, name, specifier: spec, kind: "git" });
        continue;
      }
      if (URL_SPECIFIER_PATTERN.test(spec)) {
        out.push({ source, block, name, specifier: spec, kind: "url" });
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const repoRoot = new URL("../", import.meta.url);
  const offending: UnknownDependency[] = [];
  const aliased: AliasedDependency[] = [];
  const nonRegistry: NonRegistryDependency[] = [];
  for (const rel of SCANNED_PACKAGE_JSONS) {
    const url = new URL(rel, repoRoot);
    let text: string;
    try {
      text = await readFile(url, "utf8");
    } catch (err) {
      console.error(
        `verify-known-dep-names: could not read ${rel} (${(err as Error).message})`,
      );
      process.exitCode = 1;
      return;
    }
    let pkg: PackageJsonLike;
    try {
      pkg = JSON.parse(text) as PackageJsonLike;
    } catch (err) {
      console.error(
        `verify-known-dep-names: ${rel} is not valid JSON (${(err as Error).message})`,
      );
      process.exitCode = 1;
      return;
    }
    offending.push(...findUnknownDependencyNames(rel, pkg));
    aliased.push(...findAliasedDependencySpecifiers(rel, pkg));
    nonRegistry.push(...findGitOrUrlDependencySpecifiers(rel, pkg));
  }
  if (offending.length === 0 && aliased.length === 0 && nonRegistry.length === 0) return;
  if (offending.length > 0) {
    console.error(
      `verify-known-dep-names: ${offending.length} dependency name${
        offending.length === 1 ? "" : "s"
      } not on the slopsquatting allowlist:`,
    );
    for (const v of offending) {
      console.error(`  - ${v.source} → ${v.block}["${v.name}"]`);
    }
    console.error(
      "If this is a legitimate new dependency, double-check the package name " +
        "against the upstream README / GitHub (slopsquat names like " +
        "`request-promise-native2`, `@types/fastify-helmet`, or " +
        "`huggingface-cli` often *sound* plausible) and then add the exact " +
        "name to ALLOWED_DEP_NAMES in scripts/verify-known-dep-names.ts in " +
        "the same PR. See SECURITY.md § Slopsquatting / AI package " +
        "hallucination for the threat model.",
    );
  }
  if (aliased.length > 0) {
    console.error(
      `verify-known-dep-names: ${aliased.length} npm-alias dependency specifier${
        aliased.length === 1 ? "" : "s"
      } found (dependency-confusion-via-aliasing vector):`,
    );
    for (const v of aliased) {
      console.error(
        `  - ${v.source} → ${v.block}["${v.name}"] = "${v.specifier}"`,
      );
    }
    console.error(
      "An `\"x\": \"npm:y@…\"` alias causes npmjs.com to list `x` as a dependency " +
        "on the published package page even though `x` is not a real registry entry — " +
        "a documented dependency-confusion vector (Jain & Stathako, Snyk, Nov 2021). " +
        "Inline the real package name instead. If a legitimate aliased dep is " +
        "truly required, add an explicit allowlist entry in " +
        "scripts/verify-known-dep-names.ts in the same PR.",
    );
  }
  if (nonRegistry.length > 0) {
    console.error(
      `verify-known-dep-names: ${nonRegistry.length} non-registry dependency specifier${
        nonRegistry.length === 1 ? "" : "s"
      } found (Socket gitDependency / httpDependency vector):`,
    );
    for (const v of nonRegistry) {
      console.error(
        `  - ${v.source} → ${v.block}["${v.name}"] = "${v.specifier}" (${v.kind})`,
      );
    }
    console.error(
      "Git and raw-URL specifiers are not immutable: tags / branches can be " +
        "moved, .tgz files can be silently swapped, and none of these sources " +
        "go through the registry's vetting / provenance / integrity pipeline. " +
        "See https://socket.dev/alerts/gitDependency and " +
        "https://socket.dev/alerts/httpDependency. Replace with a versioned " +
        "registry specifier; if a fork is genuinely required, publish it under " +
        "a scoped name and add that name to ALLOWED_DEP_NAMES instead.",
    );
  }
  process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(pathToFileURL(process.argv[1]).href) ===
    fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
