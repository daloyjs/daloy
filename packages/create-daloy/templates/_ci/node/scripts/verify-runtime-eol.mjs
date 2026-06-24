const EOL_WARN_DAYS = 90;
const FETCH_TIMEOUT_MS = 10_000;
const RUNTIME_FEEDS = {
  node: "nodejs",
  bun: "bun",
  deno: "deno",
};

const isDeno = typeof globalThis.Deno !== "undefined";
const args = isDeno ? globalThis.Deno.args : globalThis.process.argv.slice(2);
const cwd = isDeno ? globalThis.Deno.cwd() : globalThis.process.cwd();

function joinPath(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

async function readText(file) {
  if (isDeno) return await globalThis.Deno.readTextFile(file);
  const { readFile } = await import("node:fs/promises");
  return await readFile(file, "utf8");
}

async function readDirNames(dir) {
  if (isDeno) {
    const out = [];
    for await (const entry of globalThis.Deno.readDir(dir)) out.push(entry.name);
    return out;
  }
  const { readdir } = await import("node:fs/promises");
  return await readdir(dir);
}

function parseVersionKey(value) {
  if (typeof value !== "string") return null;
  if (/latest/i.test(value)) return null;
  const match = value.match(/v?\D*(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return match[2] ? `${Number(match[1])}.${Number(match[2])}` : String(Number(match[1]));
}

function collectFromPackageJson(json, source) {
  const out = [];
  const engines = json && typeof json === "object" ? json.engines : null;
  if (!engines || typeof engines !== "object") return out;
  for (const runtime of Object.keys(RUNTIME_FEEDS)) {
    const version = parseVersionKey(engines[runtime]);
    if (version) out.push({ runtime, version, source: `${source}: engines.${runtime}` });
  }
  return out;
}

function collectFromDenoJson(json, source) {
  const out = [];
  const version = parseVersionKey(json?.runtime?.deno ?? json?.engines?.deno);
  if (version) out.push({ runtime: "deno", version, source: `${source}: deno runtime` });
  return out;
}

function collectFromWorkflow(yaml, source) {
  const out = [];
  const patterns = [
    ["node", /node-version:\s*['"]?([^'"\n#]+)/g],
    ["bun", /bun-version:\s*['"]?([^'"\n#]+)/g],
    ["deno", /deno-version:\s*['"]?([^'"\n#]+)/g],
  ];
  for (const [runtime, pattern] of patterns) {
    let match = null;
    while ((match = pattern.exec(yaml)) !== null) {
      const version = parseVersionKey(match[1]);
      if (version) out.push({ runtime, version, source });
    }
  }
  return out;
}

async function collectPinnedVersions() {
  const found = [];
  try {
    found.push(...collectFromPackageJson(JSON.parse(await readText(joinPath(cwd, "package.json"))), "package.json"));
  } catch {
    // No package.json is fine for Deno-native scaffolds.
  }
  try {
    found.push(...collectFromDenoJson(JSON.parse(await readText(joinPath(cwd, "deno.json"))), "deno.json"));
  } catch {
    // Node/Bun scaffolds do not ship deno.json.
  }
  try {
    const workflowsDir = joinPath(cwd, ".github", "workflows");
    for (const name of await readDirNames(workflowsDir)) {
      if (!/\.(ya?ml)$/.test(name)) continue;
      found.push(...collectFromWorkflow(await readText(joinPath(workflowsDir, name)), `.github/workflows/${name}`));
    }
  } catch {
    // A local run without GitHub workflows should still scan package metadata.
  }
  return found;
}

async function fetchFeed(runtime) {
  const feed = RUNTIME_FEEDS[runtime];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://endoflife.date/api/${feed}.json`, {
      headers: {
        "User-Agent": "daloy-runtime-eol-scan/1",
        Accept: "application/json",
      },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`${feed} feed returned HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error(`${feed} feed returned a non-array payload`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function cycleNumber(cycle) {
  const n = Number.parseFloat(String(cycle));
  return Number.isFinite(n) ? n : -1;
}

function findCycle(feed, version) {
  const exact = feed.find((item) => String(item.cycle) === version);
  if (exact) return exact;
  if (!/^\d+$/.test(version)) return null;
  const major = Number(version);
  const candidates = feed
    .filter((item) => Math.floor(cycleNumber(item.cycle)) === major)
    .sort((a, b) => cycleNumber(b.cycle) - cycleNumber(a.cycle));
  return candidates[0] ?? null;
}

function daysUntil(date, now) {
  return Math.floor((date.getTime() - now.getTime()) / 86_400_000);
}

function groupPinned(pinned) {
  const grouped = new Map();
  for (const pin of pinned) {
    const key = `${pin.runtime}@${pin.version}`;
    const current = grouped.get(key);
    if (current) current.sources.add(pin.source);
    else grouped.set(key, { ...pin, sources: new Set([pin.source]) });
  }
  return [...grouped.values()];
}

function failProcess() {
  if (globalThis.process) {
    globalThis.process.exitCode = 1;
    return;
  }
  if (isDeno) globalThis.Deno.exit(1);
}

async function main() {
  const strict = args.includes("--strict");
  const now = new Date();
  const findings = [];
  const pinned = groupPinned(await collectPinnedVersions());

  if (pinned.length === 0) {
    console.log("verify-runtime-eol: no pinned runtime versions found.");
    return;
  }

  const feeds = new Map();
  for (const pin of pinned) {
    if (!feeds.has(pin.runtime)) feeds.set(pin.runtime, await fetchFeed(pin.runtime));
    const cycle = findCycle(feeds.get(pin.runtime), pin.version);
    if (!cycle || cycle.eol === false) continue;
    const eol = new Date(cycle.eol);
    if (Number.isNaN(eol.getTime())) continue;
    const remaining = daysUntil(eol, now);
    if (remaining < 0 || remaining <= EOL_WARN_DAYS) {
      findings.push({
        runtime: pin.runtime,
        version: pin.version,
        cycle: cycle.cycle,
        eol: cycle.eol,
        days: remaining,
        severity: remaining < 0 ? "eol" : "warn",
        sources: [...pin.sources].sort(),
      });
    }
  }

  for (const finding of findings) {
    const label = finding.severity === "eol" ? "EOL" : "WARNING";
    const timing =
      finding.severity === "eol"
        ? `${Math.abs(finding.days)} day(s) ago`
        : `in ${finding.days} day(s)`;
    console.error(
      `${label}: ${finding.runtime} ${finding.version} maps to cycle ${finding.cycle}, EOL ${timing} (${finding.eol}). Sources: ${finding.sources.join(", ")}`
    );
  }

  if (findings.some((f) => f.severity === "eol") || (strict && findings.length > 0)) {
    failProcess();
    return;
  }

  console.log("verify-runtime-eol: all pinned runtimes are inside supported windows.");
}

await main();
