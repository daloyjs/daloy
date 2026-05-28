/**
 * End-of-life (EOL) runtime detection — the final pillar from the
 * Aikido "DIY guide: build vs buy your OSS code scanning and app security
 * toolkit" article
 * (https://www.aikido.dev/blog/diy-guide-build-vs-buy-your-oss-code-scanning-and-app-security-toolkit).
 *
 * The other nine Aikido pillars are already covered by Daloy CI:
 *
 *   - CSPM             — N/A (framework, no cloud infrastructure ships)
 *   - SCA              — `osv-scan.yml`, `vuln-scan.yml`, `pnpm audit --prod`
 *   - Secrets          — `secret-scan.yml` (gitleaks) + verify-no-leaked-credentials
 *   - SAST             — `codeql.yml` + `opengrep.yml`
 *   - DAST             — `dast.yml` (ZAP baseline)
 *   - IaC scanning     — N/A (no Terraform / Helm / Dockerfile ships)
 *   - Container scan   — N/A (no container image ships)
 *   - License scanning — `verify-dep-licenses.ts`
 *   - Malware / supply — verify-no-lifecycle-scripts, verify-no-remote-exec,
 *                        verify-no-registry-exfiltration, verify-no-encoded-payloads,
 *                        verify-no-invisible-unicode, verify-no-vulnerable-sandboxes,
 *                        verify-known-dep-names (slopsquatting), Scorecard, zizmor
 *
 * EOL runtime detection is the remaining gap. A runtime version that has
 * reached end-of-life still installs and runs, but stops receiving security
 * patches — so users of `@daloyjs/core` can silently inherit unpatched CVEs
 * in V8, OpenSSL, libuv, etc. simply by pinning Node to a version Daloy
 * supports.
 *
 * What this script does:
 *
 *   1. Collect every Node.js major version Daloy explicitly endorses:
 *      - `engines.node` minimum in every workspace `package.json`
 *      - `node-version:` value pinned in every `.github/workflows/*.yml`
 *   2. Fetch `https://endoflife.date/api/nodejs.json` (the public CDN the
 *      Aikido article recommends; same JSON shape consumed by Scorecard,
 *      Snyk, Renovate, and many internal tooling stacks).
 *   3. Cross-reference each endorsed major against the EOL feed and:
 *      - exit 1 if any endorsed major is already EOL (hard fail)
 *      - print a WARNING to stderr if any endorsed major is within
 *        `EOL_WARN_DAYS` of its EOL date (non-blocking by default)
 *      - in `--strict` mode the warning is also a hard fail
 *
 * Network policy:
 *   - The endoflife.date endpoint is fetched with a 10 s timeout and a
 *     pinned `User-Agent: daloy-eol-scan/1`.
 *   - `--offline` skips the network fetch and reads `data/nodejs-eol.json`
 *     from disk (used by unit tests so the test suite stays hermetic).
 *
 * Exit codes:
 *   0 — every endorsed Node major is in support (or only warned).
 *   1 — at least one endorsed Node major is EOL (or warning in --strict).
 *   2 — the EOL feed could not be fetched / parsed.
 *
 * @since 0.35.2
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ENDOFLIFE_URL = "https://endoflife.date/api/nodejs.json";
const FETCH_TIMEOUT_MS = 10_000;
const EOL_WARN_DAYS = 90;

export interface NodeEolCycle {
  readonly cycle: string;
  readonly eol: string | false;
  readonly latest?: string;
  readonly lts?: string | boolean;
  readonly support?: string | false;
}

export interface EndorsedVersion {
  readonly source: string;
  readonly major: number;
}

export interface EolFinding {
  readonly major: number;
  readonly cycle: string;
  readonly eol: string;
  readonly daysUntilEol: number;
  readonly severity: "eol" | "warn";
  readonly sources: readonly string[];
}

const PACKAGE_JSON_GLOBS = [
  "package.json",
  "packages/create-daloy/package.json",
  "packages/create-daloy/templates/node-basic/package.json",
  "website/package.json",
];

/**
 * Extract the minimum supported Node major from an `engines.node` value
 * like `">=24.0.0"`, `"^24.1.0"`, `"24.x"`, or `"24"`. Returns `null`
 * when the value cannot be parsed; the caller decides whether to error.
 */
export function parseEnginesNodeMajor(spec: string | undefined): number | null {
  if (typeof spec !== "string") return null;
  const match = spec.match(/(\d+)/);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Collect every Node major pinned via `node-version:` in a workflow YAML.
 * Quoted (`"24"`) and bare (`24`, `24.1`) forms are both supported.
 */
export function parseWorkflowNodeMajors(yaml: string): readonly number[] {
  const result: number[] = [];
  const re = /node-version:\s*['"]?(\d+)(?:\.\d+)*['"]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(yaml)) !== null) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) result.push(n);
  }
  return result;
}

async function readJson(path: string): Promise<unknown> {
  const txt = await readFile(path, "utf8");
  return JSON.parse(txt) as unknown;
}

async function collectEndorsedVersions(cwd: string): Promise<EndorsedVersion[]> {
  const found: EndorsedVersion[] = [];

  for (const rel of PACKAGE_JSON_GLOBS) {
    try {
      const pkg = (await readJson(join(cwd, rel))) as {
        engines?: { node?: string };
      };
      const major = parseEnginesNodeMajor(pkg.engines?.node);
      if (major !== null) found.push({ source: rel, major });
    } catch {
      // Missing workspace package.json is fine; the verify-* scripts run
      // from the repo root in CI and only a subset of these paths exist
      // depending on the workspace layout being checked.
    }
  }

  const workflowsDir = join(cwd, ".github", "workflows");
  try {
    const entries = await readdir(workflowsDir);
    for (const name of entries) {
      if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
      const yaml = await readFile(join(workflowsDir, name), "utf8");
      for (const major of parseWorkflowNodeMajors(yaml)) {
        found.push({ source: `.github/workflows/${name}`, major });
      }
    }
  } catch {
    // No workflows directory — nothing to scan, not fatal.
  }

  return found;
}

/**
 * Group endorsed versions by Node major so the EOL report attributes each
 * finding back to every package.json / workflow that pinned it.
 */
export function groupBySource(versions: readonly EndorsedVersion[]): Map<number, string[]> {
  const grouped = new Map<number, string[]>();
  for (const v of versions) {
    const arr = grouped.get(v.major);
    if (arr) {
      if (!arr.includes(v.source)) arr.push(v.source);
    } else {
      grouped.set(v.major, [v.source]);
    }
  }
  return grouped;
}

async function fetchEolFeed(offlinePath: string | null): Promise<NodeEolCycle[]> {
  if (offlinePath !== null) {
    const txt = await readFile(offlinePath, "utf8");
    return JSON.parse(txt) as NodeEolCycle[];
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ENDOFLIFE_URL, {
      headers: {
        "User-Agent": "daloy-eol-scan/1 (+https://github.com/daloyjs/daloy)",
        Accept: "application/json",
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`endoflife.date returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as NodeEolCycle[];
    if (!Array.isArray(json)) {
      throw new Error("endoflife.date returned a non-array payload");
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compare each endorsed Node major against the EOL feed and produce a
 * finding when the cycle is past its EOL date or within `warnDays` of it.
 */
export function evaluateFindings(
  endorsed: ReadonlyMap<number, readonly string[]>,
  feed: readonly NodeEolCycle[],
  now: Date,
  warnDays: number = EOL_WARN_DAYS,
): EolFinding[] {
  const out: EolFinding[] = [];
  for (const [major, sources] of endorsed) {
    const cycle = feed.find((c) => Number.parseInt(c.cycle, 10) === major);
    if (!cycle) {
      // No matching cycle (e.g. Node 27 before it ships). Treat as
      // informational only — there is nothing to fail on.
      continue;
    }
    if (cycle.eol === false) continue; // "never" — skip
    const eolDate = new Date(cycle.eol);
    if (Number.isNaN(eolDate.getTime())) continue;
    const msPerDay = 86_400_000;
    const daysUntilEol = Math.floor((eolDate.getTime() - now.getTime()) / msPerDay);
    if (daysUntilEol < 0) {
      out.push({
        major,
        cycle: cycle.cycle,
        eol: cycle.eol,
        daysUntilEol,
        severity: "eol",
        sources: [...sources].sort(),
      });
    } else if (daysUntilEol <= warnDays) {
      out.push({
        major,
        cycle: cycle.cycle,
        eol: cycle.eol,
        daysUntilEol,
        severity: "warn",
        sources: [...sources].sort(),
      });
    }
  }
  return out;
}

function formatFinding(f: EolFinding): string {
  const where = f.sources.join(", ");
  if (f.severity === "eol") {
    return `EOL  Node ${f.major} (cycle ${f.cycle}) reached end-of-life on ${f.eol} (${Math.abs(f.daysUntilEol)} days ago) — pinned in: ${where}`;
  }
  return `WARN Node ${f.major} (cycle ${f.cycle}) reaches end-of-life on ${f.eol} (in ${f.daysUntilEol} days) — pinned in: ${where}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const offlineIdx = args.indexOf("--offline");
  const offlinePath = offlineIdx >= 0 ? (args[offlineIdx + 1] ?? null) : null;

  const cwd = process.cwd();
  const endorsed = await collectEndorsedVersions(cwd);
  if (endorsed.length === 0) {
    process.stderr.write(
      "verify-runtime-eol: no Node engines/pins found — nothing to check.\n",
    );
    process.exit(0);
  }
  const grouped = groupBySource(endorsed);

  let feed: NodeEolCycle[];
  try {
    feed = await fetchEolFeed(offlinePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`verify-runtime-eol: failed to load EOL feed: ${msg}\n`);
    process.exit(2);
    return;
  }

  const findings = evaluateFindings(grouped, feed, new Date());

  if (findings.length === 0) {
    const majors = [...grouped.keys()].sort((a, b) => a - b).join(", ");
    process.stdout.write(
      `verify-runtime-eol: OK — Node major(s) ${majors} are within support.\n`,
    );
    process.exit(0);
    return;
  }

  let eolCount = 0;
  let warnCount = 0;
  for (const f of findings) {
    process.stderr.write(`${formatFinding(f)}\n`);
    if (f.severity === "eol") eolCount += 1;
    else warnCount += 1;
  }

  if (eolCount > 0 || (strict && warnCount > 0)) {
    process.stderr.write(
      `verify-runtime-eol: FAIL — ${eolCount} EOL major(s), ${warnCount} approaching-EOL major(s).\n`,
    );
    process.exit(1);
    return;
  }
  process.stdout.write(
    `verify-runtime-eol: OK with ${warnCount} warning(s) (non-blocking; pass --strict to fail).\n`,
  );
}

// Allow this file to be imported by tests without side-effects.
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  void main();
}
