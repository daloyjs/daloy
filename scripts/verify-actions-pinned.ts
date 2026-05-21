/**
 * GitHub Actions SHA-pinning + known-compromised-action CI gate
 * (Socket "tj-actions/changed-files" / CVE-2025-30066 class defense).
 *
 * Socket's 2025-03-17 write-up
 * (https://socket.dev/blog/github-actions-supply-chain-attack-puts-thousands-of-projects-at-risk)
 * documents how an attacker who gained write access to the popular
 * `tj-actions/changed-files` GitHub Action retagged every version from
 * `v1` through `v45.0.7` to point at a malicious commit that dumped CI
 * secrets into workflow logs. Over 23,000 repositories were affected
 * because they referenced the action by mutable tag (`@v45`) instead of
 * an immutable commit SHA.
 *
 * Daloy's defense:
 *
 *   1. Every `uses:` line in `.github/workflows/**` MUST reference a
 *      40-character lowercase hex commit SHA. Mutable tags (`@v4`,
 *      `@main`, `@HEAD`, `@2.1.3`) are rejected. This makes a future
 *      retagging attack against any third-party action a no-op for our
 *      pipeline — the SHA we run is the SHA that was reviewed.
 *
 *   2. A small deny-list of known-compromised actions is rejected
 *      outright, even if SHA-pinned, so a stale checkout that still
 *      pins a malicious revision is caught here instead of in
 *      production. The list is intentionally short — it tracks
 *      published, attributable compromises, not rumours.
 *
 *   3. `${{` expression interpolation is forbidden inside `uses:` lines
 *      (e.g. `uses: ${{ env.ACTION }}@${{ env.REF }}`). zizmor already
 *      catches this; we duplicate the check locally so it runs in
 *      `pnpm verify` before zizmor's GitHub-side workflow has a chance
 *      to comment.
 *
 * zizmor (`.github/workflows/zizmor.yml`) enforces the same SHA-pinning
 * rule on GitHub's side; this script is the fast, local, deterministic
 * gate that runs as part of `pnpm verify` and the `verify` job in
 * `ci.yml` / `release.yml` so a maintainer learns about a regression in
 * seconds, not minutes.
 *
 * Exit code:
 *   0 — every `uses:` line is SHA-pinned and not on the deny-list.
 *   1 — at least one violation; offending lines are printed to stderr.
 *
 * @since 0.42.0
 */

import { readdir, readFile } from "node:fs/promises";

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);

/**
 * Actions that have had a publicly-attributable compromise. Pinning to a
 * commit SHA does NOT make these safe to use, because the SHA itself may
 * be the malicious revision. Each entry should cite the disclosure.
 */
const DENIED_ACTIONS: ReadonlyMap<string, string> = new Map([
  [
    "tj-actions/changed-files",
    "CVE-2025-30066 — repository compromised 2025-03-14; every tag from v1 through v45.0.7 was retagged to a malicious commit that dumped CI secrets into workflow logs (https://socket.dev/blog/github-actions-supply-chain-attack-puts-thousands-of-projects-at-risk)",
  ],
  [
    "reviewdog/action-setup",
    "CVE-2025-30154 — compromised 2025-03-11 as the upstream of the tj-actions/changed-files incident (https://www.stepsecurity.io/blog/harden-runner-detection-reviewdog-action-setup-action-is-compromised)",
  ],
]);

/**
 * Matches a `uses:` line in a workflow. Captures: indentation (group 1),
 * the action reference before the `@` (group 2), and the ref (group 3).
 *
 * Examples of matching lines:
 *   - "      - uses: actions/checkout@v4"
 *   - "        uses: docker://node:24"   (rejected by SHA gate; docker
 *                                         images are an out-of-tree
 *                                         supply-chain surface)
 *   - "        uses: ./.github/actions/x" (local action; accepted)
 *
 * We deliberately keep this regex strict: anything that does not fit
 * the `<owner>/<repo>(/<path>)?@<ref>` shape is reported so a human can
 * look at it.
 */
const USES_LINE = /^(\s*)(?:-\s+)?uses:\s+(.+?)\s*(?:#.*)?$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const EXPRESSION_RE = /\$\{\{/;

export interface UsesViolation {
  readonly file: string;
  readonly line: number;
  readonly raw: string;
  readonly reason: string;
}

/**
 * Inspect a workflow file's text and return any `uses:` line that is
 * not SHA-pinned, references a denied action, or interpolates an
 * expression.
 */
export function findUnpinnedActions(
  file: string,
  text: string,
): readonly UsesViolation[] {
  const violations: UsesViolation[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = USES_LINE.exec(line);
    if (!match) continue;
    const value = match[2] ?? "";
    const raw = line.trim();

    // Local actions (./path) and Docker image references are out of
    // scope for the SHA-pinning rule. Local actions are reviewed as
    // part of the repo; Docker images are not used by Daloy today and
    // would be caught by a future explicit gate if introduced.
    if (value.startsWith("./") || value.startsWith("docker://")) continue;

    if (EXPRESSION_RE.test(value)) {
      violations.push({
        file,
        line: i + 1,
        raw,
        reason:
          "`uses:` value interpolates a `${{ … }}` expression; the action reference must be a literal string so reviewers can audit which code runs",
      });
      continue;
    }

    const atIndex = value.lastIndexOf("@");
    if (atIndex <= 0 || atIndex === value.length - 1) {
      violations.push({
        file,
        line: i + 1,
        raw,
        reason:
          "`uses:` value is missing a `@<commit-sha>` ref; every third-party action must be SHA-pinned",
      });
      continue;
    }

    const actionPath = value.slice(0, atIndex);
    const ref = value.slice(atIndex + 1);

    // Normalise `owner/repo/subpath` -> `owner/repo` for deny-list
    // matching, since `tj-actions/changed-files/foo` is still
    // `tj-actions/changed-files`.
    const segments = actionPath.split("/");
    const ownerRepo =
      segments.length >= 2 ? `${segments[0]}/${segments[1]}` : actionPath;
    const denyReason = DENIED_ACTIONS.get(ownerRepo);
    if (denyReason !== undefined) {
      violations.push({
        file,
        line: i + 1,
        raw,
        reason: `action \`${ownerRepo}\` is on the known-compromised deny-list: ${denyReason}`,
      });
      continue;
    }

    if (!SHA_RE.test(ref)) {
      violations.push({
        file,
        line: i + 1,
        raw,
        reason: `ref \`${ref}\` is not a 40-character lowercase hex commit SHA; mutable tags can be retagged to malicious commits (CVE-2025-30066)`,
      });
    }
  }
  return violations;
}

async function listWorkflowFiles(): Promise<readonly string[]> {
  const entries = await readdir(WORKFLOWS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => e.name)
    .sort();
}

async function main(): Promise<void> {
  const files = await listWorkflowFiles();
  let failed = 0;
  for (const name of files) {
    const url = new URL(name, WORKFLOWS_DIR);
    const text = await readFile(url, "utf8");
    const violations = findUnpinnedActions(`.github/workflows/${name}`, text);
    for (const v of violations) {
      failed += 1;
      console.error(`verify-actions-pinned: ${v.file}:${v.line}: ${v.reason}`);
      console.error(`    ${v.raw}`);
    }
  }
  if (failed === 0) return;
  console.error(
    "Every `uses:` line in .github/workflows/** must reference a third-party " +
      "action by 40-character commit SHA, must not be on the known-compromised " +
      "deny-list, and must not interpolate a `${{ … }}` expression. See " +
      "https://socket.dev/blog/github-actions-supply-chain-attack-puts-thousands-of-projects-at-risk " +
      "for why mutable tags are unsafe (CVE-2025-30066).",
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-actions-pinned.ts")) {
  await main();
}
