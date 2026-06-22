import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { findForbiddenLockfileSources } from "../scripts/verify-lockfile-sources.ts";

async function readWorkspaceFile(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("root npmrc blocks install-time supply-chain attack paths", async () => {
  const npmrc = await readWorkspaceFile(".npmrc");

  assert.match(npmrc, /^ignore-scripts=true$/m);
  assert.match(npmrc, /^minimum-release-age=1440$/m);
  assert.match(npmrc, /^verify-store-integrity=true$/m);
  assert.match(npmrc, /^frozen-lockfile=true$/m);
  assert.match(npmrc, /^strict-peer-dependencies=true$/m);
  assert.match(npmrc, /^provenance=true$/m);
});

test("package.json keeps the lockfile verifier and no stale pnpm mirror", async () => {
  const packageJson = JSON.parse(await readWorkspaceFile("package.json"));

  assert.equal(packageJson.scripts["verify:lockfile"], "node --import tsx scripts/verify-lockfile-sources.ts");
  assert.equal(packageJson.pnpm, undefined);
});

test("pnpm-workspace.yaml enables pnpm 11 supply-chain controls", async () => {
  const workspace = await readWorkspaceFile("pnpm-workspace.yaml");

  // 24h release-age cooldown — blocks freshly published malicious versions.
  assert.match(workspace, /^minimumReleaseAge:\s*1440$/m);

  // Transitive deps must not pull from git or arbitrary tarball URLs.
  assert.match(workspace, /^blockExoticSubdeps:\s*true$/m);

  // Refuse to install dependencies with unreviewed install scripts.
  assert.match(workspace, /^strictDepBuilds:\s*true$/m);

  // Scripts must not run against a stale node_modules.
  assert.match(workspace, /^verifyDepsBeforeRun:\s*install$/m);

  // Explicit build allowlist — esbuild is the only package permitted to run
  // install scripts. Adding more requires a deliberate PR.
  assert.match(workspace, /^allowBuilds:\s*$/m);
  assert.match(workspace, /^\s{2}esbuild:\s*true$/m);
});

test("lockfile does not contain git or non-registry tarball dependency sources", async () => {
  const lockfile = await readWorkspaceFile("pnpm-lock.yaml");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), []);
  assert.deepEqual(findForbiddenLockfileSources("specifier: github:owner/project"), [
    {
      line: 1,
      reason: "git dependency source",
      text: "specifier: github:owner/project",
    },
  ]);
  assert.deepEqual(findForbiddenLockfileSources("resolution: {tarball: https://example.com/pkg.tgz}"), [
    {
      line: 1,
      reason: "non-registry tarball source",
      text: "resolution: {tarball: https://example.com/pkg.tgz}",
    },
  ]);
});

test("lockfile scanner rejects every forbidden git and tarball source with line numbers", () => {
  const lockfile = [
    "packages:",
    "  dep-a:",
    "    specifier: github:owner/project",
    "  dep-b:",
    "    resolution: git+ssh://git@github.com/owner/project.git",
    "  dep-c:",
    "    specifier: git@github.com:owner/project.git",
    "  dep-d:",
    "    resolution: {tarball: https://cdn.example.com/pkg.tgz}",
  ].join("\n");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), [
    {
      line: 3,
      reason: "git dependency source",
      text: "specifier: github:owner/project",
    },
    {
      line: 5,
      reason: "git dependency source",
      text: "resolution: git+ssh://git@github.com/owner/project.git",
    },
    {
      line: 7,
      reason: "git dependency source",
      text: "specifier: git@github.com:owner/project.git",
    },
    {
      line: 9,
      reason: "non-registry tarball source",
      text: "resolution: {tarball: https://cdn.example.com/pkg.tgz}",
    },
  ]);
});

test("lockfile scanner rejects registry lookalike tarball hosts", () => {
  const lockfile = [
    "resolution: {tarball: https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz}",
    "resolution: {tarball: https://registry.npmjs.org.evil.example/pkg.tgz}",
  ].join("\n");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), [
    {
      line: 2,
      reason: "non-registry tarball source",
      text: "resolution: {tarball: https://registry.npmjs.org.evil.example/pkg.tgz}",
    },
  ]);
});

test("lockfile scanner rejects every npm git shorthand specifier (github/gitlab/bitbucket/gist)", () => {
  // Socket's "Git dependency" critical alert (https://socket.dev/blog/5-new-critical-issue-alerts)
  // covers every mutable git host, not just GitHub. Every npm-documented shorthand
  // (https://docs.npmjs.com/cli/v8/configuring-npm/package-json#git-urls-as-dependencies)
  // must be rejected by `pnpm verify:lockfile`.
  const lockfile = [
    "specifier: github:owner/project",
    "specifier: gitlab:owner/project",
    "specifier: bitbucket:owner/project",
    "specifier: gist:abc123",
    "resolution: git@gitlab.com:owner/project.git",
    "resolution: git@bitbucket.org:owner/project.git",
  ].join("\n");

  const findings = findForbiddenLockfileSources(lockfile);
  assert.equal(findings.length, 6);
  for (const finding of findings) {
    assert.equal(finding.reason, "git dependency source");
  }
});

test("lockfile scanner rejects every known-malicious Lazarus BeaverTail typosquat", () => {
  // Socket 2025-03-10 — six typosquatted npm packages embedding BeaverTail /
  // InvisibleFerret. Documented at
  // https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages.
  // Any future PR that pulls one of these into `pnpm-lock.yaml` (direct or
  // transitive) must be rejected by `pnpm verify:lockfile` before merge.
  const lockfile = [
    "packages:",
    "  is-buffer-validator@1.0.0:",
    "    resolution: {integrity: sha512-aaaa}",
    "  yoojae-validator@1.0.0:",
    "    resolution: {integrity: sha512-bbbb}",
    "  event-handle-package@1.0.0:",
    "    resolution: {integrity: sha512-cccc}",
    "  array-empty-validator@1.0.0:",
    "    resolution: {integrity: sha512-dddd}",
    "  react-event-dependency@1.0.0:",
    "    resolution: {integrity: sha512-eeee}",
    "  auth-validator@1.0.0:",
    "    resolution: {integrity: sha512-ffff}",
  ].join("\n");

  const findings = findForbiddenLockfileSources(lockfile);
  assert.equal(findings.length, 6, JSON.stringify(findings, null, 2));
  for (const finding of findings) {
    assert.equal(
      finding.reason,
      "known-malicious package (Lazarus BeaverTail / InvisibleFerret)",
    );
  }
  assert.match(findings[0]!.text, /is-buffer-validator/);
  assert.match(findings[1]!.text, /yoojae-validator/);
  assert.match(findings[2]!.text, /event-handle-package/);
  assert.match(findings[3]!.text, /array-empty-validator/);
  assert.match(findings[4]!.text, /react-event-dependency/);
  assert.match(findings[5]!.text, /auth-validator/);
});

test("lockfile scanner rejects every xuxingfeng destructive-payload May 2025 typosquat", () => {
  // Socket 2025-05-21 — eight npm packages by the `xuxingfeng` alias that
  // typosquat or mimic popular Vite/React/Vue/Quill plugins and ship
  // time-delayed payloads that `process.execSync` `rimraf`/`rm -rf` against
  // `node_modules`, force `shutdown -s -t 5`, monkey-patch
  // `Array.prototype` / `String.prototype`, and corrupt browser storage.
  // Documented at
  // https://socket.dev/blog/malicious-npm-packages-target-react-vue-and-vite-ecosystems-with-destructive-payloads.
  const lockfile = [
    "packages:",
    "  js-bomb@1.1.1:",
    "    resolution: {integrity: sha512-aaaa}",
    "  js-hood@1.0.1:",
    "    resolution: {integrity: sha512-bbbb}",
    "  vite-plugin-bomb@2.0.2:",
    "    resolution: {integrity: sha512-cccc}",
    "  vite-plugin-bomb-extend@2.0.2:",
    "    resolution: {integrity: sha512-dddd}",
    "  vite-plugin-react-extend@1.0.4:",
    "    resolution: {integrity: sha512-eeee}",
    "  vite-plugin-vue-extend@1.0.9:",
    "    resolution: {integrity: sha512-ffff}",
    "  vue-plugin-bomb@2.0.0:",
    "    resolution: {integrity: sha512-gggg}",
    "  quill-image-downloader@1.3.7:",
    "    resolution: {integrity: sha512-hhhh}",
  ].join("\n");

  const findings = findForbiddenLockfileSources(lockfile);
  assert.equal(findings.length, 8, JSON.stringify(findings, null, 2));
  for (const finding of findings) {
    assert.equal(
      finding.reason,
      "known-malicious package (xuxingfeng destructive-payload campaign, May 2025)",
    );
  }
  assert.match(findings[0]!.text, /js-bomb/);
  assert.match(findings[1]!.text, /js-hood/);
  assert.match(findings[2]!.text, /vite-plugin-bomb@/);
  assert.match(findings[3]!.text, /vite-plugin-bomb-extend/);
  assert.match(findings[4]!.text, /vite-plugin-react-extend/);
  assert.match(findings[5]!.text, /vite-plugin-vue-extend/);
  assert.match(findings[6]!.text, /vue-plugin-bomb/);
  assert.match(findings[7]!.text, /quill-image-downloader/);
});

test("lockfile scanner allows the legitimate Vite/Quill plugins that xuxingfeng mimics", () => {
  // Regression: the xuxingfeng blocklist must be exact-name only — the
  // legitimate `@vitejs/plugin-react`, `@vitejs/plugin-vue`,
  // `vite-plugin-html`, `quill-image-uploader`, `quill-image-drop-module`,
  // and `quill-image-resize-module` packages must NOT be flagged.
  const lockfile = [
    "packages:",
    "  '@vitejs/plugin-react@4.3.4':",
    "    resolution: {integrity: sha512-real-hash}",
    "  '@vitejs/plugin-vue@5.2.1':",
    "    resolution: {integrity: sha512-real-hash}",
    "  vite-plugin-html@3.2.2:",
    "    resolution: {integrity: sha512-real-hash}",
    "  quill-image-uploader@1.3.0:",
    "    resolution: {integrity: sha512-real-hash}",
    "  quill-image-drop-module@1.0.3:",
    "    resolution: {integrity: sha512-real-hash}",
    "  quill-image-resize-module@3.0.0:",
    "    resolution: {integrity: sha512-real-hash}",
  ].join("\n");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), []);
});

test("lockfile scanner allows the legitimate is-buffer package (exact-match blocklist)", () => {
  // Regression: `is-buffer-validator` is the Lazarus typosquat, NOT the
  // legitimate `is-buffer` package by Feross Aboukhadijeh (33M weekly
  // downloads). The blocklist must be exact-name only — a real `is-buffer`
  // entry must NOT be flagged.
  const lockfile = [
    "packages:",
    "  is-buffer@2.0.5:",
    "    resolution: {integrity: sha512-real-hash}",
    "  some-pkg@1.0.0:",
    "    dependencies:",
    "      is-buffer: 2.0.5",
  ].join("\n");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), []);
});

test("lockfile scanner rejects Beamglea phishing-CDN October 2025 `redirect-<id>` packages", () => {
  // Socket 2025-10-09 — 175 npm packages published across 9 throwaway
  // accounts that abuse `unpkg.com` as a free CDN to serve `beamglea.js`
  // redirect scripts to victims who open phishing HTML attachments.
  // 174 of the package names match `^redirect-[a-z0-9]{6}$` and one is
  // the outlier `redirect-homer-flajpt`. Documented at
  // https://socket.dev/blog/175-malicious-npm-packages-host-phishing-infrastructure.
  const lockfile = [
    "packages:",
    "  redirect-xs13nr@1.0.0:",
    "    resolution: {integrity: sha512-aaaa}",
    "  redirect-04g1my@1.0.0:",
    "    resolution: {integrity: sha512-bbbb}",
    "  redirect-zoju4g@1.0.0:",
    "    resolution: {integrity: sha512-cccc}",
    "  redirect-homer-flajpt@1.0.3:",
    "    resolution: {integrity: sha512-dddd}",
    "  some-pkg@1.0.0:",
    "    dependencies:",
    "      redirect-nf0qo1: 1.0.0",
  ].join("\n");

  const findings = findForbiddenLockfileSources(lockfile);
  assert.equal(findings.length, 5, JSON.stringify(findings, null, 2));
  for (const finding of findings) {
    assert.equal(
      finding.reason,
      "known-malicious package (Beamglea phishing-CDN campaign, October 2025)",
    );
  }
  assert.match(findings[0]!.text, /redirect-xs13nr/);
  assert.match(findings[1]!.text, /redirect-04g1my/);
  assert.match(findings[2]!.text, /redirect-zoju4g/);
  assert.match(findings[3]!.text, /redirect-homer-flajpt/);
  assert.match(findings[4]!.text, /redirect-nf0qo1/);
});

test("lockfile scanner allows benign `redirect-*` package names outside the Beamglea pattern", () => {
  // Regression: the Beamglea regex is anchored on exactly 6 lowercase
  // alphanumeric characters after `redirect-`, so legitimate `redirect-*`
  // packages with longer / shorter / hyphenated suffixes must NOT trip
  // the gate. Common real packages on npm: `redirect-loop` (5 chars,
  // hyphenless), `redirect-tape` (4 chars), `redirect-debounce`
  // (8 chars), `redirect-pathname` (8 chars).
  const lockfile = [
    "packages:",
    "  redirect-loop@1.0.0:",
    "    resolution: {integrity: sha512-real-hash}",
    "  redirect-tape@1.0.0:",
    "    resolution: {integrity: sha512-real-hash}",
    "  redirect-debounce@1.0.0:",
    "    resolution: {integrity: sha512-real-hash}",
    "  redirect@1.0.0:",
    "    resolution: {integrity: sha512-real-hash}",
    "  some-redirect-abcdef@1.0.0:",
    "    resolution: {integrity: sha512-real-hash}",
  ].join("\n");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), []);
});

test("lockfile scanner rejects every Qix / DuckDB Sep 2025 crypto-clipper version", () => {  // Socket 2025-09-08 (https://socket.dev/blog/npm-author-qix-compromised-in-major-supply-chain-attack)
  // and the Aikido DuckDB follow-up (https://www.aikido.dev/blog/duckdb-npm-packages-compromised):
  // the maintainer "Qix" was phished and trojanised versions of 19 foundational
  // packages were published with a browser crypto-clipper payload. The legit
  // package names remain safe — only these exact versions are blocked.
  const lockfile = [
    "packages:",
    "  ansi-regex@6.2.1:",
    "  ansi-styles@6.2.2:",
    "  backslash@0.2.1:",
    "  chalk@5.6.1:",
    "  chalk-template@1.1.1:",
    "  color-convert@3.1.1:",
    "  color-name@2.0.1:",
    "  color-string@2.1.1:",
    "  debug@4.4.2:",
    "  error-ex@1.3.3:",
    "  has-ansi@6.0.1:",
    "  is-arrayish@0.3.3:",
    "  proto-tinker-wc@1.8.7:",
    "  proto-tinker-wc@0.1.87:",
    "  simple-swizzle@0.2.3:",
    "  slice-ansi@7.1.1:",
    "  strip-ansi@7.1.1:",
    "  supports-color@10.2.1:",
    "  supports-hyperlinks@4.1.1:",
    "  wrap-ansi@9.0.1:",
  ].join("\n");

  const findings = findForbiddenLockfileSources(lockfile);
  assert.equal(findings.length, 20, JSON.stringify(findings, null, 2));
  for (const finding of findings) {
    assert.equal(
      finding.reason,
      "known-compromised version (Qix / DuckDB crypto-clipper, Sep 2025)",
    );
  }
});

test("lockfile scanner allows safe (non-compromised) versions of Qix-maintained packages", () => {
  // The blocklist is version-pinned: chalk, debug, ansi-styles etc. remain
  // legitimate packages — only the trojanised Sep-2025 versions are blocked.
  // Any earlier or later untainted release must continue to install cleanly.
  const lockfile = [
    "packages:",
    "  chalk@5.6.0:",
    "    resolution: {integrity: sha512-aaa}",
    "  chalk@5.6.2:",
    "    resolution: {integrity: sha512-bbb}",
    "  debug@4.4.1:",
    "  debug@4.4.3:",
    "  ansi-styles@6.2.1:",
    "  strip-ansi@7.1.0:",
  ].join("\n");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), []);
});

test("lockfile scanner flags compromised versions even with pnpm peer-dep suffix", () => {
  // pnpm v9+ disambiguates a package built against multiple peer-dep versions
  // by appending `(peer@version)` to the lockfile key — e.g.
  // `debug@4.4.2(supports-color@10.2.1)`. The version match must strip that
  // suffix before comparing, otherwise a real-world poisoned lockfile would
  // slip past the gate.
  const lockfile = [
    "packages:",
    "  debug@4.4.2(supports-color@10.2.1):",
    "    resolution: {integrity: sha512-zzz}",
  ].join("\n");

  const findings = findForbiddenLockfileSources(lockfile);
  assert.equal(findings.length, 1);
  assert.equal(
    findings[0]!.reason,
    "known-compromised version (Qix / DuckDB crypto-clipper, Sep 2025)",
  );
});

test("lockfile scanner rejects every Snyk string-width-cjs lookalike (Oct 2024 Tea-token campaign)", () => {
  // Snyk 2024-10-03 — three anonymous npm packages whose names mimic the
  // legitimate string-width / strip-ansi / wrap-ansi packages by appending
  // a `-cjs` suffix, plus the `clazz-transformer` typosquat of
  // `class-transformer`. Documented at
  // https://snyk.io/blog/supply-chain-string-width-cjs-npm/.
  const lockfile = [
    "packages:",
    "  string-width-cjs@4.2.3:",
    "    resolution: {integrity: sha512-aaaa}",
    "  strip-ansi-cjs@6.0.1:",
    "    resolution: {integrity: sha512-bbbb}",
    "  wrap-ansi-cjs@7.0.0:",
    "    resolution: {integrity: sha512-cccc}",
    "  clazz-transformer@1.0.0:",
    "    resolution: {integrity: sha512-dddd}",
  ].join("\n");

  const findings = findForbiddenLockfileSources(lockfile);
  assert.equal(findings.length, 4, JSON.stringify(findings, null, 2));
  for (const finding of findings) {
    assert.equal(
      finding.reason,
      "known-malicious package (string-width-cjs lookalike / Tea-token farming campaign, October 2024)",
    );
  }
  assert.match(findings[0]!.text, /string-width-cjs/);
  assert.match(findings[1]!.text, /strip-ansi-cjs/);
  assert.match(findings[2]!.text, /wrap-ansi-cjs/);
  assert.match(findings[3]!.text, /clazz-transformer/);
});

test("lockfile scanner allows the legitimate string-width / strip-ansi / wrap-ansi / class-transformer packages", () => {
  // Regression: the *-cjs blocklist must be exact-name only — the real
  // `string-width`, `strip-ansi`, `wrap-ansi`, and `class-transformer`
  // packages (combined: hundreds of millions of weekly downloads) must
  // NOT be flagged.
  const lockfile = [
    "packages:",
    "  string-width@4.2.3:",
    "    resolution: {integrity: sha512-real-hash}",
    "  strip-ansi@6.0.1:",
    "    resolution: {integrity: sha512-real-hash}",
    "  wrap-ansi@7.0.0:",
    "    resolution: {integrity: sha512-real-hash}",
    "  class-transformer@0.5.1:",
    "    resolution: {integrity: sha512-real-hash}",
  ].join("\n");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), []);
});

test("lockfile scanner rejects npm package-aliasing specifiers (Snyk string-width-cjs laundering vector)", () => {
  // Snyk 2024-10-03 (https://snyk.io/blog/supply-chain-string-width-cjs-npm/):
  // the `npm:<real-pkg>@<range>` aliasing syntax is the laundering vector
  // that lets an attacker dress a fake `string-width-cjs` package as the
  // legitimate `string-width@^4.2.0`. Daloy uses zero aliases — every
  // `npm:` specifier in `pnpm-lock.yaml` must be reviewed in the PR diff
  // before merge.
  const lockfile = [
    "importers:",
    "  .:",
    "    dependencies:",
    "      string-width-cjs:",
    "        specifier: npm:string-width@^4.2.0",
    "        version: string-width@4.2.3",
    "      lodash-aliased:",
    "        specifier: 'npm:lodash@^4.17.21'",
    "        version: lodash@4.17.21",
  ].join("\n");

  const findings = findForbiddenLockfileSources(lockfile);
  const aliasFindings = findings.filter(
    (f) => f.reason === "npm package aliasing (lockfile-lint pattern)",
  );
  assert.equal(aliasFindings.length, 2, JSON.stringify(findings, null, 2));
  assert.match(aliasFindings[0]!.text, /npm:string-width/);
  assert.match(aliasFindings[1]!.text, /npm:lodash/);
});

test("lockfile scanner does not confuse `npm` package names with `npm:` alias prefixes", () => {
  // Regression: a legitimate package literally named `npm` (or a
  // dependency on `@npmcli/*`, `npm-run-all`, etc.) must not trip the
  // alias detector. Only the `specifier: npm:<...>` / `version: npm:<...>`
  // shape is forbidden.
  const lockfile = [
    "packages:",
    "  npm@10.9.0:",
    "    resolution: {integrity: sha512-real-hash}",
    "  '@npmcli/fs@4.0.0':",
    "    resolution: {integrity: sha512-real-hash}",
    "  npm-run-all@4.1.5:",
    "    resolution: {integrity: sha512-real-hash}",
    "importers:",
    "  .:",
    "    dependencies:",
    "      npm:",
    "        specifier: ^10.9.0",
    "        version: 10.9.0",
  ].join("\n");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), []);
});

test("ci workflow avoids privileged fork-pr and cache-poisoning patterns", async () => {
  const workflow = await readWorkspaceFile(".github/workflows/ci.yml");

  assert.doesNotMatch(workflow, /^\s*pull_request_target:/m);
  assert.doesNotMatch(workflow, /cache:\s*pnpm/);
  assert.match(workflow, /permissions:\s*\{\}/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.match(workflow, /pnpm verify:lockfile/);
  assert.match(workflow, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /pnpm\/action-setup@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}\s+# v6/);
});

test("all workflows avoid unsafe pull_request_target and zizmor is enforced", async () => {
  const workflowDir = new URL("../.github/workflows/", import.meta.url);
  const workflowFiles = (await readdir(workflowDir)).filter((file) => /\.ya?ml$/.test(file));
  const pullRequestTargetWorkflows: string[] = [];

  for (const file of workflowFiles) {
    const workflow = await readWorkspaceFile(`.github/workflows/${file}`);
    if (/^\s*pull_request_target:/m.test(workflow)) {
      pullRequestTargetWorkflows.push(file);
    }
  }

  assert.deepEqual(pullRequestTargetWorkflows, ["close-external-prs.yml"]);

  const closeExternalPrs = await readWorkspaceFile(".github/workflows/close-external-prs.yml");
  assert.doesNotMatch(closeExternalPrs, /^\s*uses:\s*/m);
  assert.doesNotMatch(closeExternalPrs, /^\s*id-token:\s*write\s*$/m);
  assert.doesNotMatch(closeExternalPrs, /^\s*actions:\s*write\s*$/m);
  assert.doesNotMatch(closeExternalPrs, /^\s*packages:\s*write\s*$/m);
  assert.doesNotMatch(closeExternalPrs, /^\s*issues:\s*write\s*$/m);
  assert.doesNotMatch(closeExternalPrs, /^\s*contents:\s*write\s*$/m);
  assert.match(closeExternalPrs, /^\s*contents:\s*read\s*$/m);
  assert.match(closeExternalPrs, /^\s*pull-requests:\s*write\s*$/m);
  assert.match(closeExternalPrs, /github\.repository == 'daloyjs\/daloy'/);
  assert.match(closeExternalPrs, /^\s*timeout-minutes:\s*5\s*$/m);
  assert.match(closeExternalPrs, /author_association != 'OWNER'/);
  assert.match(closeExternalPrs, /author_association != 'MEMBER'/);
  assert.match(closeExternalPrs, /author_association != 'COLLABORATOR'/);
  assert.match(closeExternalPrs, /user\.login != 'dependabot\[bot\]'/);
  assert.match(closeExternalPrs, /gh pr comment/);
  assert.match(closeExternalPrs, /gh pr close/);

  const zizmor = await readWorkspaceFile(".github/workflows/zizmor.yml");
  assert.match(zizmor, /^\s*pull_request:\s*$/m);
  assert.match(zizmor, /permissions:\s*\{\}/);
  assert.match(zizmor, /zizmorcore\/zizmor-action@[0-9a-f]{40}\s+# v0\.5\.7/);
  assert.match(zizmor, /version:\s*v1\.25\.0/);
});

test("release workflow isolates npm publish permissions", async () => {
  const workflow = await readWorkspaceFile(".github/workflows/release.yml");
  const stagedPublishes = workflow.match(/npm stage publish \. --access public --provenance/g) ?? [];
  const stagedPublishingCliInstalls =
    workflow.match(/npm install -g npm@11\.15\.0 --ignore-scripts --no-audit --no-fund/g) ?? [];

  assert.doesNotMatch(workflow, /^\s*pull_request:/m);
  assert.doesNotMatch(workflow, /^\s*pull_request_target:/m);
  assert.match(workflow, /permissions:\s*\{\}/);
  assert.match(workflow, /environment:\s*\n\s+name:\s+\$\{\{ vars\.NPM_PUBLISH_ENVIRONMENT \|\| 'npm-publish' \}\}/);
  assert.match(workflow, /id-token:\s*write/);
  assert.equal(stagedPublishes.length, 2);
  assert.equal(stagedPublishingCliInstalls.length, 2);
  assert.match(workflow, /npm stage --help >\/dev\/null/);
  assert.doesNotMatch(workflow, /pnpm publish --access public --no-git-checks --provenance/);
  assert.match(workflow, /egress-policy:\s*block/);
  assert.match(workflow, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /pnpm\/action-setup@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}\s+# v6/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  assert.doesNotMatch(workflow, /^\s*NODE_AUTH_TOKEN:/m);

  assert.doesNotMatch(workflow, /^\s*always-auth:/m);

  const verifyJob = workflow.match(/  verify:[\s\S]*?\n\n  publish-core:/)?.[0] ?? "";
  assert.doesNotMatch(verifyJob, /id-token:\s*write/);
});
