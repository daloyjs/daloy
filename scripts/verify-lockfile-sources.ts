import { readFile } from "node:fs/promises";

export interface ForbiddenLockfileSource {
  line: number;
  reason: "git dependency source" | "non-registry tarball source";
  text: string;
}

const GIT_SOURCE_PATTERN = /(?:specifier:\s*)?(?:github:|git\+|git:\/\/|ssh:\/\/git@|git@github\.com:)/i;
const TARBALL_PATTERN = /tarball:\s*(?<url>https?:\/\/[^}\s]+)/i;
const REGISTRY_TARBALL_PREFIX = "https://registry.npmjs.org/";

export function findForbiddenLockfileSources(lockfile: string): ForbiddenLockfileSource[] {
  const findings: ForbiddenLockfileSource[] = [];
  const lines = lockfile.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const text = rawLine.trim();
    if (GIT_SOURCE_PATTERN.test(text)) {
      findings.push({ line: index + 1, reason: "git dependency source", text });
      continue;
    }

    const tarball = TARBALL_PATTERN.exec(text)?.groups?.url;
    if (tarball && !tarball.startsWith(REGISTRY_TARBALL_PREFIX)) {
      findings.push({ line: index + 1, reason: "non-registry tarball source", text });
    }
  }
  return findings;
}

async function main(): Promise<void> {
  const lockfile = await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
  const findings = findForbiddenLockfileSources(lockfile);
  if (findings.length === 0) return;

  for (const finding of findings) {
    console.error(`${finding.reason} on line ${finding.line}: ${finding.text}`);
  }
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-lockfile-sources.ts")) {
  await main();
}
