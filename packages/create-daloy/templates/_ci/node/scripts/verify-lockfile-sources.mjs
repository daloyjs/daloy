import { access, readFile } from "node:fs/promises";

const TEXT_LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lock"];
const BINARY_LOCKFILES = ["bun.lockb"];
const GIT_SOURCE_PATTERN =
  /(?:specifier:\s*)?(?:github:|gitlab:|bitbucket:|gist:|git\+|git:\/\/|ssh:\/\/git@|git@github\.com:|git@gitlab\.com:|git@bitbucket\.org:)|\btype:\s*git\b/i;
// `"x": "npm:y@1"` installs a different package under a trusted name.
const ALIAS_PATTERN = /(?:specifier|version):\s*['"]?npm:/i;
// bun.lock keys a non-registry package as `"name@https://host/pkg.tgz"`.
const BUN_URL_KEY_PATTERN = /["'][^"'\s]+@https?:\/\/(?!registry\.npmjs\.org\/)[^"'\s]+["']/i;
const URL_PATTERN = /(?:tarball|resolved)["':\s]+(?<url>https?:\/\/[^"'\s},]+)/i;
const ALLOWED_TARBALL_PREFIXES = ["https://registry.npmjs.org/", "https://registry.yarnpkg.com/"];

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function findForbiddenSources(lockfile) {
  const findings = [];
  const lines = lockfile.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const text = rawLine.trim();
    if (GIT_SOURCE_PATTERN.test(text)) {
      findings.push({ line: index + 1, reason: "git dependency source", text });
      continue;
    }

    if (ALIAS_PATTERN.test(text)) {
      findings.push({ line: index + 1, reason: "npm package alias", text });
      continue;
    }
    if (BUN_URL_KEY_PATTERN.test(text)) {
      findings.push({ line: index + 1, reason: "non-registry tarball source", text });
      continue;
    }

    const url = URL_PATTERN.exec(text)?.groups?.url;
    if (url && !ALLOWED_TARBALL_PREFIXES.some((prefix) => url.startsWith(prefix))) {
      findings.push({ line: index + 1, reason: "non-registry tarball source", text });
    }
  }
  return findings;
}

let checked = false;
let failed = false;

for (const file of TEXT_LOCKFILES) {
  if (!(await exists(file))) continue;
  checked = true;
  const findings = findForbiddenSources(await readFile(file, "utf8"));
  for (const finding of findings) {
    failed = true;
    console.error(`${file}: ${finding.reason} on line ${finding.line}: ${finding.text}`);
  }
}

for (const file of BINARY_LOCKFILES) {
  if (await exists(file)) {
    failed = true;
    console.error(`${file}: binary lockfiles cannot be source-verified; use a text lockfile in CI.`);
  }
}

if (!checked) {
  failed = true;
  console.error("No text lockfile found. Commit a lockfile before relying on CI.");
}

if (failed) process.exitCode = 1;