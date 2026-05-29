// Shared helpers for the bench scripts.
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import os from "node:os";

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(__dirname);

export const DEFAULT_PORT = 3456;

// Best-effort, cross-platform power-source detection. Returns the AC/battery
// state so benchmark results can record whether the machine was running on
// battery — laptops (especially Apple silicon MacBooks) throttle the CPU and
// vary clocks aggressively on battery, which makes throughput numbers noisy
// and not comparable to an on-AC run. Never throws: any failure → "unknown".
export function detectPowerSource() {
  try {
    if (process.platform === "darwin") {
      // `pmset -g batt` prints e.g. "Now drawing from 'AC Power'".
      const out = execFileSync("pmset", ["-g", "batt"], {
        encoding: "utf8",
        timeout: 2_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (/drawing from 'AC Power'/i.test(out)) return { onBattery: false, source: "AC" };
      if (/drawing from 'Battery Power'/i.test(out)) return { onBattery: true, source: "battery" };
      return { onBattery: undefined, source: "unknown" };
    }
    if (process.platform === "linux") {
      // Look for a mains/AC adapter under /sys/class/power_supply.
      const base = "/sys/class/power_supply";
      for (const name of readdirSync(base)) {
        let type = "";
        try { type = readFileSync(path.join(base, name, "type"), "utf8").trim(); } catch { continue; }
        if (type === "Mains") {
          const online = readFileSync(path.join(base, name, "online"), "utf8").trim();
          const onAc = online === "1";
          return { onBattery: !onAc, source: onAc ? "AC" : "battery" };
        }
      }
      return { onBattery: undefined, source: "unknown" };
    }
    if (process.platform === "win32") {
      // BatteryStatus 2 == "AC connected". No battery present → no rows.
      const out = execFileSync(
        "powershell",
        ["-NoProfile", "-Command", "(Get-CimInstance Win32_Battery).BatteryStatus"],
        { encoding: "utf8", timeout: 4_000, stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (out === "") return { onBattery: false, source: "AC" }; // desktop / no battery
      const status = Number(out.split(/\s+/)[0]);
      const onBattery = status === 1;
      return { onBattery, source: onBattery ? "battery" : "AC" };
    }
  } catch {
    /* fall through to unknown */
  }
  return { onBattery: undefined, source: "unknown" };
}

// Best-effort soft file-descriptor limit (POSIX only). macOS defaults to a
// soft limit of 256, which autocannon (hundreds of client sockets) plus the
// server's accepted sockets can exhaust, producing EMFILE and bogus error
// rates. Returns a number, or undefined when it can't be determined.
export function detectFdLimit() {
  if (process.platform === "win32") return undefined;
  try {
    const out = execFileSync("sh", ["-c", "ulimit -n"], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^unlimited$/i.test(out)) return Infinity;
    const n = Number(out);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

export function machineInfo() {
  const cpus = os.cpus();
  const power = detectPowerSource();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    totalMemGiB: +(os.totalmem() / 1024 ** 3).toFixed(2),
    loadAvg: os.loadavg(),
    onBattery: power.onBattery,
    powerSource: power.source,
    fdLimit: detectFdLimit(),
  };
}

// Print a one-time warning to stderr when the environment is likely to produce
// noisy or unreliable benchmark numbers: running on battery (CPU throttling) or
// a file-descriptor soft limit too low for the requested connection count.
// Purely advisory — never throws, never changes the run. `maxConnections` is
// the highest connection count the caller will drive (defaults to 100).
export function warnBenchEnvironment({ maxConnections = 100 } = {}) {
  const info = machineInfo();
  if (info.onBattery === true) {
    console.error(
      "⚠ Running on BATTERY power. Laptops throttle the CPU on battery, so " +
      "throughput/latency numbers will be noisy and not comparable to an " +
      "on-AC run. Plug in for stable results.",
    );
  }
  // Each connection needs a client socket + an accepted server socket, plus
  // headroom for stdio, the spawned child, and Node internals. Warn well
  // before the hard ceiling.
  if (typeof info.fdLimit === "number" && info.fdLimit !== Infinity) {
    const needed = maxConnections * 3 + 64;
    if (info.fdLimit < needed) {
      console.error(
        `⚠ File-descriptor soft limit is ${info.fdLimit}, which may be too low ` +
        `for ${maxConnections} connections (need ~${needed}). On macOS/Linux run ` +
        `\`ulimit -n 4096\` in this shell before benchmarking to avoid EMFILE errors.`,
      );
    }
  }
}

export function parseArgs(argv) {
  return Object.fromEntries(
    argv.slice(2)
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, v] = a.replace(/^--/, "").split("=");
        return [k, v ?? "true"];
      }),
  );
}

export async function startServer(file, { port = DEFAULT_PORT, extraEnv = {}, readyTimeoutMs = 20_000 } = {}) {
  // Avoid EADDRINUSE when a previous SIGKILLed listener hasn't released the
  // socket yet (common on macOS for listeners that didn't set SO_REUSEADDR).
  await waitForPortFree(port).catch(() => {});
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--import", "tsx", path.join(ROOT, file)],
    {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), NODE_ENV: "production", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolve, reject) => {
    let resolved = false;
    let stderrBuf = "";
    let stdoutBuf = "";
    const MAX_DIAG_BYTES = 64 * 1024;
    const onStdout = (buf) => {
      const s = buf.toString();
      if (!resolved && stdoutBuf.length < MAX_DIAG_BYTES) stdoutBuf += s;
      if (resolved) return;
      if (s.includes(`READY ${port}`)) {
        resolved = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", (buf) => {
      if (resolved || stderrBuf.length >= MAX_DIAG_BYTES) return;
      stderrBuf += buf.toString();
    });
    child.once("exit", (code) => {
      if (!resolved) {
        reject(new Error(`Server exited with code ${code} before READY.\nstdout: ${stdoutBuf}\nstderr: ${stderrBuf}`));
      }
    });
    setTimeout(() => {
      if (!resolved) {
        try { child.kill("SIGKILL"); } catch {}
        reject(new Error(`Server did not emit READY within ${readyTimeoutMs}ms.\nstdout: ${stdoutBuf}\nstderr: ${stderrBuf}`));
      }
    }, readyTimeoutMs);
  });
}

export async function killServer(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((r) => child.once("exit", () => r(true))),
    wait(3_000, false),
  ]);
  if (!exited) child.kill("SIGKILL");
  await wait(250);
}

// Wait until `port` is free to bind on both IPv4 (127.0.0.1) and IPv6 (::).
// Some adapters (Hono's node-server) bind to "::" and will hit EADDRINUSE
// against lingering listener sockets from a SIGKILLed predecessor.
export async function waitForPortFree(port, { timeoutMs = 10_000 } = {}) {
  const tryBind = (host) => new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    try { s.listen(port, host); } catch { resolve(false); }
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await tryBind("127.0.0.1")) && (await tryBind("::"))) return;
    await wait(100);
  }
  throw new Error(`Port ${port} did not become free within ${timeoutMs}ms.`);
}

// Population stats. Operates on a numeric array.
export function stats(xs) {
  if (xs.length === 0) return { n: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median,
    stddev: Math.sqrt(variance),
  };
}

export function pct(xs, p) {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// HTTP GET with timeout. Returns { status, body } or throws.
export async function httpRequest(url, { method = "GET", headers = {}, body, timeoutMs = 5_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, body: text, headers: Object.fromEntries(res.headers) };
  } finally {
    clearTimeout(t);
  }
}

// Wait for a server to respond 200 to a probe URL. Used as a soft readiness check.
export async function waitForHealthy(port, pathOk = "/static", { timeoutMs = 10_000, headers } = {}) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await httpRequest(`http://127.0.0.1:${port}${pathOk}`, { timeoutMs: 1_000, headers });
      if (r.status === 200) return Date.now() - start;
    } catch (e) {
      lastErr = e;
    }
    await wait(20);
  }
  throw new Error(`Server not healthy within ${timeoutMs}ms: ${lastErr?.message ?? "(no response)"}`);
}

// Format a number with thousands separator.
export function fmt(n) {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}
