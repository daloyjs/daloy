#!/usr/bin/env node
// create-daloy — scaffold a new DaloyJS project.
// Zero runtime dependencies; uses only Node built-ins.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const TEMPLATES_DIR = path.join(PKG_ROOT, "templates");
const CI_TEMPLATES_DIR = path.join(TEMPLATES_DIR, "_ci");

const TEMPLATE_OPTIONS = [
  {
    value: "node-basic",
    title: "Node API",
    description: "Traditional REST API with secure defaults and Hey API codegen",
  },
  {
    value: "vercel-edge",
    title: "Vercel Edge",
    description: "Catch-all Edge API route using @daloyjs/core/vercel",
  },
  {
    value: "cloudflare-worker",
    title: "Cloudflare Workers",
    description: "Worker entrypoint with wrangler dev/deploy scripts",
  },
  {
    value: "bun-basic",
    title: "Bun API",
    description: "Bun-native server with `bun --hot`, `bun test`, and Hey API codegen",
  },
  {
    value: "deno-basic",
    title: "Deno API",
    description: "Deno-native server with `deno task dev`, `deno test`, and `npm:` imports",
  },
];

const PACKAGE_MANAGER_OPTIONS = [
  { value: "pnpm", title: "pnpm", description: "Recommended for DaloyJS projects" },
  { value: "npm", title: "npm", description: "Use the npm client you already have" },
  { value: "yarn", title: "Yarn", description: "Classic create workflow" },
  { value: "bun", title: "Bun", description: "Fast install and runtime tooling" },
];

const TEMPLATES = TEMPLATE_OPTIONS.map((option) => option.value);
const PACKAGE_MANAGERS = PACKAGE_MANAGER_OPTIONS.map((option) => option.value);

const RENAME_ON_COPY = new Map([
  ["_gitignore", ".gitignore"],
  ["_npmrc", ".npmrc"],
  ["_env.example", ".env.example"],
  ["_github", ".github"],
  // Directory: holds skill files for AI coding agents under
  // `.agents/skills/<skill-name>/SKILL.md`. Templates author this as
  // `_agents/` so npm pack does not drop the dotfolder during publish.
  ["_agents", ".agents"],
]);

// Templates that target a runtime instead of an npm package manager.
// For these templates we skip Node-style `<pm> install`, do not patch
// `package.json`, and let the user drive the runtime directly
// (e.g. `deno task dev`).
const NO_PACKAGE_JSON_TEMPLATES = new Set(["deno-basic"]);

// Text-file extensions that the `--minimal` post-processor scans for
// `daloy-minimal:strip-start <tag>` / `daloy-minimal:strip-end <tag>`
// sentinels.
const MINIMAL_STRIP_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".md"]);
const CI_PLACEHOLDER_EXTENSIONS = new Set([".json", ".md", ".mjs", ".yaml", ".yml"]);
const CI_PLACEHOLDER_FILES = new Set(["CODEOWNERS"]);

// ----------------------------------------------------------------------------
// Terminal capability detection + style primitives.
//
// Zero runtime dependencies: we hand-roll color, Unicode, and box-drawing
// helpers so the CLI ships fast and stays auditable.
// ----------------------------------------------------------------------------

const SUPPORTS_COLOR = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const SUPPORTS_TRUECOLOR =
  SUPPORTS_COLOR && (process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit");
const SUPPORTS_UNICODE =
  process.platform !== "win32" ||
  Boolean(process.env.WT_SESSION) ||
  process.env.TERM_PROGRAM === "vscode" ||
  process.env.TERM === "xterm-256color";

const COLORS = SUPPORTS_COLOR
  ? {
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      italic: "\x1b[3m",
      underline: "\x1b[4m",
      inverse: "\x1b[7m",
      cyan: "\x1b[36m",
      green: "\x1b[32m",
      red: "\x1b[31m",
      yellow: "\x1b[33m",
      magenta: "\x1b[35m",
      gray: "\x1b[90m",
      white: "\x1b[97m",
    }
  : {
      reset: "",
      bold: "",
      dim: "",
      italic: "",
      underline: "",
      inverse: "",
      cyan: "",
      green: "",
      red: "",
      yellow: "",
      magenta: "",
      gray: "",
      white: "",
    };

function color(code, s) {
  return `${code}${s}${COLORS.reset}`;
}

function rgb(r, g, b) {
  if (!SUPPORTS_TRUECOLOR) return "";
  return `\x1b[38;2;${r};${g};${b}m`;
}

function stringWidth(s) {
  let width = 0;
  for (const char of s.replace(/\x1b\[[0-9;]*m/g, "")) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue;
    if (
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1faff))
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

// Unicode/ASCII glyphs used throughout the prompt UI. Symbols mirror Clack
// and Astro's `create` flows so users get the familiar vertical-rail
// experience, with safe ASCII fallbacks for legacy terminals.
const SYMBOLS = SUPPORTS_UNICODE
  ? {
      stepActive: "\u25C6", // ◆
      stepDone: "\u25C7", // ◇
      radioOff: "\u25CB", // ○
      radioOn: "\u25C9", // ◉
      success: "\u2714", // ✔
      warn: "\u26A0", // ⚠
      error: "\u2716", // ✖
      info: "\u2139", // ℹ
      bar: "\u2502", // │
      arrow: "\u2192", // →
      pointer: "\u276F", // ❯
      sparkle: "\u2728", // ✨
      star: "\u2605", // ★
      cornerTL: "\u256D", // ╭
      cornerTR: "\u256E", // ╮
      cornerBL: "\u2570", // ╰
      cornerBR: "\u256F", // ╯
      lineH: "\u2500", // ─
      lineV: "\u2502", // │
    }
  : {
      stepActive: "*",
      stepDone: "o",
      radioOff: "( )",
      radioOn: "(*)",
      success: "v",
      warn: "!",
      error: "x",
      info: "i",
      bar: "|",
      arrow: ">",
      pointer: ">",
      sparkle: "*",
      star: "*",
      cornerTL: "+",
      cornerTR: "+",
      cornerBL: "+",
      cornerBR: "+",
      lineH: "-",
      lineV: "|",
    };

// Pretty rail-printer. All interactive prompts and status lines flow through
// these helpers so the column with the vertical bar stays aligned.
const BAR = color(COLORS.gray, SYMBOLS.bar);

function printIntro(title) {
  console.log(`${color(COLORS.cyan, SYMBOLS.cornerTL + SYMBOLS.lineH)}  ${color(COLORS.bold, title)}`);
  console.log(BAR);
}

function printOutro(text) {
  console.log(`${color(COLORS.cyan, SYMBOLS.cornerBL + SYMBOLS.lineH)}  ${text}`);
}

function printRailLine(text = "") {
  console.log(`${BAR}  ${text}`);
}

function printRailGap() {
  console.log(BAR);
}

// Render a horizontally-bounded box with a title bar. Used for the welcome
// banner and the final "Next steps" outro.
function renderBox(lines, options = {}) {
  const innerPadding = 2;
  const contentWidth = Math.max(40, ...lines.map((line) => stringWidth(line)));
  const horizontal = SYMBOLS.lineH.repeat(contentWidth + innerPadding * 2);
  const accent = options.accent ?? COLORS.cyan;
  const top = color(accent, `${SYMBOLS.cornerTL}${horizontal}${SYMBOLS.cornerTR}`);
  const bottom = color(accent, `${SYMBOLS.cornerBL}${horizontal}${SYMBOLS.cornerBR}`);
  const out = [top];
  for (const line of lines) {
    const padding = " ".repeat(Math.max(0, contentWidth - stringWidth(line)));
    out.push(`${color(accent, SYMBOLS.lineV)}${" ".repeat(innerPadding)}${line}${padding}${" ".repeat(innerPadding)}${color(accent, SYMBOLS.lineV)}`);
  }
  out.push(bottom);
  return out.join("\n");
}

// Block-letter "DALOY" banner with a left-to-right cyan→magenta gradient when
// the terminal supports truecolor. Falls back to a single bold-cyan line on
// non-truecolor TTYs and to plain text in dumb terminals. The shape is built
// from half-block characters so it stays compact (2 lines tall).
const LOGO_LINES = [
  " \u2588\u2580\u2584    \u2584\u2580\u2588    \u2588      \u2588\u2580\u2588   \u2588   \u2588 ",
  " \u2588\u2584\u2580    \u2588\u2580\u2588    \u2588\u2584\u2584   \u2588\u2584\u2588    \u2580\u2584\u2580 ",
];

function gradientLine(line, startRgb, endRgb) {
  if (!SUPPORTS_TRUECOLOR) return color(COLORS.cyan, line);
  const chars = [...line];
  const max = Math.max(1, chars.length - 1);
  let out = "";
  for (let i = 0; i < chars.length; i += 1) {
    const ratio = i / max;
    const r = Math.round(startRgb[0] + (endRgb[0] - startRgb[0]) * ratio);
    const g = Math.round(startRgb[1] + (endRgb[1] - startRgb[1]) * ratio);
    const b = Math.round(startRgb[2] + (endRgb[2] - startRgb[2]) * ratio);
    out += `${rgb(r, g, b)}${chars[i]}`;
  }
  return `${out}${COLORS.reset}`;
}

function printBanner(version) {
  if (!SUPPORTS_UNICODE) {
    console.log(`\n${color(COLORS.bold, "create-daloy")}  ${color(COLORS.dim, `v${version}`)}`);
    console.log(color(COLORS.dim, "Contract-first REST APIs for Node, Bun, Deno, Vercel Edge, and Workers"));
    console.log(color(COLORS.dim, "https://daloyjs.dev\n"));
    return;
  }
  const start = [56, 189, 248]; // sky-400
  const end = [217, 70, 239]; // fuchsia-500
  console.log("");
  for (const line of LOGO_LINES) {
    console.log(` ${gradientLine(line, start, end)}`);
  }
  // Build the welcome content lines (each contains its own ANSI color codes).
  const headline = `${color(COLORS.bold, "Welcome to DaloyJS")}  ${color(COLORS.gray, `\u2014 v${version}`)}`;
  const subline = color(COLORS.dim, "Contract-first REST APIs for Node, Bun, Deno, Vercel Edge, and Workers.");
  const docs = `${color(COLORS.gray, "docs:")} ${color(COLORS.cyan, "https://daloyjs.dev/docs")}`;
  console.log("");
  console.log(renderBox([headline, subline, "", docs]));
  console.log("");
}


function printHelp() {
  const heading = (text) => color(COLORS.bold + COLORS.cyan, text);
  console.log(`
${color(COLORS.bold, "create-daloy")}  ${color(COLORS.dim, "\u2014 scaffold a DaloyJS project")}

${heading("Usage")}
  ${color(COLORS.cyan, "pnpm")} create daloy@latest ${color(COLORS.dim, "[project-name] [options]")}
  ${color(COLORS.cyan, "npm")}  create daloy@latest ${color(COLORS.dim, "[project-name] [options]")}
  ${color(COLORS.cyan, "yarn")} create daloy       ${color(COLORS.dim, "[project-name] [options]")}
  ${color(COLORS.cyan, "bun")}  create daloy       ${color(COLORS.dim, "[project-name] [options]")}

${heading("Options")}
  ${color(COLORS.green, "--template <name>")}          ${TEMPLATES.join(" | ")}  ${color(COLORS.dim, "(default: node-basic)")}
  ${color(COLORS.green, "--package-manager <pm>")}     ${PACKAGE_MANAGERS.join(" | ")}  ${color(COLORS.dim, "(default: pnpm)")}
  ${color(COLORS.green, "--list-templates")}           Print available templates and exit.
  ${color(COLORS.green, "--install / --no-install")}   Install dependencies after scaffolding.
  ${color(COLORS.green, "--git / --no-git")}           Initialize a git repository.
  ${color(COLORS.green, "--minimal")}                  Strip the bookstore + Swagger/OpenAPI demo routes.
  ${color(COLORS.green, "--with-ci / --no-ci")}         Add hardened GitHub Actions + governance files.
  ${color(COLORS.green, "--code-owner <owner>")}        CODEOWNERS owner for --with-ci, e.g. @acme/security.
  ${color(COLORS.green, "--force")}                    Overwrite an existing non-empty directory.
  ${color(COLORS.green, "--yes, -y")}                  Accept all defaults; never prompt.
  ${color(COLORS.green, "--help, -h")}                 Print this help.
  ${color(COLORS.green, "--version, -v")}              Print version.

${heading("Docs")}  ${color(COLORS.cyan, "https://daloyjs.dev/docs")}
`);
}

function printTemplates() {
  console.log("");
  console.log(`${color(COLORS.cyan, SYMBOLS.sparkle)}  ${color(COLORS.bold, "Available DaloyJS templates")}`);
  console.log("");
  const valueWidth = Math.max(...TEMPLATE_OPTIONS.map((option) => option.value.length));
  for (const option of TEMPLATE_OPTIONS) {
    const value = color(COLORS.cyan, option.value.padEnd(valueWidth));
    const title = color(COLORS.bold, option.title);
    console.log(`  ${color(COLORS.gray, SYMBOLS.pointer)} ${value}  ${title}`);
    console.log(`    ${color(COLORS.dim, option.description)}`);
    console.log("");
  }
}

async function readPkgVersion() {
  try {
    const raw = await readFile(path.join(PKG_ROOT, "package.json"), "utf8");
    return JSON.parse(raw).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parseArgs(argv) {
  const out = {
    projectName: undefined,
    template: undefined,
    packageManager: undefined,
    install: undefined,
    git: undefined,
    force: false,
    yes: false,
    help: false,
    version: false,
    listTemplates: false,
    minimal: false,
    ci: undefined,
    codeOwner: undefined,
  };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--version" || a === "-v") out.version = true;
    else if (a === "--list-templates") out.listTemplates = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--force") out.force = true;
    else if (a === "--minimal") out.minimal = true;
    else if (a === "--with-ci") out.ci = true;
    else if (a === "--no-ci") out.ci = false;
    else if (a === "--code-owner") out.codeOwner = args.shift();
    else if (a?.startsWith("--code-owner=")) out.codeOwner = a.slice("--code-owner=".length);
    else if (a === "--install") out.install = true;
    else if (a === "--no-install") out.install = false;
    else if (a === "--git") out.git = true;
    else if (a === "--no-git") out.git = false;
    else if (a === "--template") out.template = args.shift();
    else if (a?.startsWith("--template=")) out.template = a.slice("--template=".length);
    else if (a === "--package-manager" || a === "--pm") out.packageManager = args.shift();
    else if (a?.startsWith("--package-manager=")) out.packageManager = a.slice("--package-manager=".length);
    else if (a?.startsWith("--pm=")) out.packageManager = a.slice("--pm=".length);
    else if (a && !a.startsWith("-") && out.projectName === undefined) out.projectName = a;
    else if (a) {
      logError(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

function detectPackageManager() {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  if (ua.startsWith("npm")) return "npm";
  return "pnpm";
}

const VALID_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
// Match the GitHub CODEOWNERS owner grammar: a personal handle (@user), an
// organization team (@org/team), or an email address. Anything else is
// rejected so the scaffolded CODEOWNERS stays meaningful for branch protection.
const VALID_CODE_OWNER =
  /^(?:@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})$/;

function validateProjectName(name) {
  if (!name || !name.trim()) return "Project name cannot be empty.";
  if (name === "." || name === "..") return "Use a real directory name.";
  if (name.length > 214) return "Project name is too long (max 214 chars).";
  if (!VALID_NAME.test(name)) {
    return "Project name must be a valid npm package name (lowercase, no spaces, no leading dot/underscore).";
  }
  return true;
}

async function isDirEmpty(dir) {
  try {
    const entries = await readdir(dir);
    return entries.length === 0;
  } catch {
    return true;
  }
}

async function copyTemplate(src, dest) {
  const entries = await readdir(src, { withFileTypes: true });
  await mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const renamed = RENAME_ON_COPY.get(entry.name) ?? entry.name;
    const from = path.join(src, entry.name);
    const to = path.join(dest, renamed);
    if (entry.isDirectory()) {
      await copyTemplate(from, to);
    } else if (entry.isFile()) {
      await copyFile(from, to);
    }
  }
}

async function patchPackageJson(dir, projectName, packageManager) {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return;
  const raw = await readFile(file, "utf8");
  const json = JSON.parse(raw);
  json.name = projectName.startsWith("@") ? projectName : projectName.toLowerCase();
  if (json.scripts && packageManager && packageManager !== "pnpm") {
    json.scripts = rewriteScriptsForPackageManager(json.scripts, packageManager);
  }
  await writeFile(file, JSON.stringify(json, null, 2) + "\n", "utf8");
}

async function patchTemplateTextFiles(dir, packageManager) {
  if (packageManager === "pnpm") return;
  // README.md and AGENTS.md sit at the repo root; SKILL.md lives under
  // `.agents/skills/daloyjs-best-practices/` so it follows the open
  // "agents/skills" convention. After copyTemplate runs, the `_agents`
  // template folder has already been renamed to `.agents`.
  const targets = [
    "README.md",
    "AGENTS.md",
    path.join(".agents", "skills", "daloyjs-best-practices", "SKILL.md"),
  ];
  for (const fileName of targets) {
    const file = path.join(dir, fileName);
    if (!existsSync(file)) continue;
    const raw = await readFile(file, "utf8");
    const next = rewritePackageManagerText(raw, packageManager);
    if (next !== raw) await writeFile(file, next, "utf8");
  }
}

function rewritePackageManagerText(raw, packageManager) {
  return raw
    .replace(
      "Package manager: pnpm (use `pnpm` unless the project's `package.json` was rewritten for npm/yarn/bun).",
      `Package manager: ${packageManager}.`,
    )
    .replace(/\bpnpm install\b/g, `${packageManager} install`)
    .replace(/\bpnpm gen:openapi\b/g, `${packageManager} run gen:openapi`)
    .replace(/\bpnpm gen:client\b/g, `${packageManager} run gen:client`)
    .replace(/\bpnpm typecheck\b/g, `${packageManager} run typecheck`)
    .replace(/\bpnpm build\b/g, `${packageManager} run build`)
    .replace(/\bpnpm deploy\b/g, `${packageManager} run deploy`)
    .replace(/\bpnpm dev\b/g, `${packageManager} run dev`)
    .replace(/\bpnpm gen\b/g, `${packageManager} run gen`)
    .replace(/\bpnpm test\b/g, `${packageManager} test`)
    .replace(/\bpnpm audit\b/g, `${packageManager} audit`)
    .replace(
      "- Hardened `.npmrc` for safer installs.",
      `- Package-manager scripts adjusted for ${packageManager}.`,
    )
    .replace(
      "- Hey API codegen wired to `pnpm gen`.",
      `- Hey API codegen wired to \`${packageManager} run gen\`.`,
    )
    .replace(
      "- Do not add runtime dependencies without checking the hardened `.npmrc` (installs wait 24h after publish by default).",
      `- Add runtime dependencies with \`${packageManager} install <package>\` and rerun the quality gates after dependency changes.`,
    );
}

/**
 * Rewrite scaffolded package.json scripts so they work under the user's
 * chosen package manager. Templates are authored with `pnpm` because that
 * is the recommended manager, but `pnpm <subscript>` and `pnpm audit` will
 * fail under npm/yarn/bun. We rewrite both forms to the equivalent that
 * the chosen manager understands.
 */
function rewriteScriptsForPackageManager(scripts, pm) {
  // `pnpm audit` → `<pm> audit`. yarn/bun also expose an `audit` command;
  // npm of course does too. Keep flags intact.
  // `pnpm <subscript>` (where subscript is another script in the same
  // package.json) → `<pm> run <subscript>` so cross-script chains work
  // everywhere. Both yarn and bun also accept `<pm> run <name>`.
  const out = {};
  const subscriptNames = new Set(Object.keys(scripts));
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string") {
      out[name] = command;
      continue;
    }
    let next = command.replace(/\bpnpm\s+audit\b/g, `${pm} audit`);
    next = next.replace(/\bpnpm\s+([a-zA-Z0-9_:-]+)/g, (match, sub) => {
      if (sub === "audit") return match; // already handled above
      if (!subscriptNames.has(sub)) return match;
      return `${pm} run ${sub}`;
    });
    out[name] = next;
  }
  return out;
}

async function normalizePackageManagerFiles(dir, packageManager) {
  if (packageManager === "pnpm") return;
  // The hardened `.npmrc` and `pnpm-workspace.yaml` only make sense for pnpm.
  // Removing them keeps npm/yarn/bun scaffolds from inheriting pnpm-specific
  // settings the chosen package manager would either ignore or misinterpret.
  for (const file of [".npmrc", "pnpm-workspace.yaml"]) {
    const target = path.join(dir, file);
    if (existsSync(target)) {
      await rm(target, { force: true });
    }
  }
}

function hasPackageScript(packageJson, scriptName) {
  return typeof packageJson?.scripts?.[scriptName] === "string";
}

function runScriptCommand(packageManager, scriptName) {
  if (packageManager === "pnpm") return `pnpm ${scriptName}`;
  if (packageManager === "npm") return scriptName === "test" ? "npm test" : `npm run ${scriptName}`;
  if (packageManager === "yarn") return scriptName === "test" ? "yarn test" : `yarn run ${scriptName}`;
  if (packageManager === "bun") return scriptName === "test" ? "bun test" : `bun run ${scriptName}`;
  return `${packageManager} run ${scriptName}`;
}

function installCommand(packageManager) {
  if (packageManager === "pnpm") return "pnpm install --frozen-lockfile --ignore-scripts";
  if (packageManager === "npm") return "npm ci --ignore-scripts";
  if (packageManager === "yarn") return "yarn install --frozen-lockfile --ignore-scripts";
  if (packageManager === "bun") return "bun install --frozen-lockfile --ignore-scripts";
  return `${packageManager} install`;
}

function auditCommand(packageManager) {
  if (packageManager === "pnpm") return "pnpm audit --prod";
  if (packageManager === "npm") return "npm audit --omit=dev";
  if (packageManager === "yarn") return "yarn audit --groups dependencies";
  if (packageManager === "bun") return "bun audit";
  return "";
}

function setupPackageManagerStep(packageManager) {
  if (packageManager === "pnpm") {
    return `      - name: Set up pnpm
        uses: pnpm/action-setup@ac6db6d3c1f721f886538a378a2d73e85697340a # v6
        with:
          version: 11.1.2
          run_install: false`;
  }
  if (packageManager === "yarn") {
    return `      - name: Enable Corepack
        run: corepack enable`;
  }
  if (packageManager === "bun") return setupBunStep();
  return "";
}

function setupBunStep() {
  return `      - name: Set up Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
        with:
          bun-version: latest`;
}

function workflowStep(name, command) {
  return `      - name: ${name}
        run: ${command}`;
}

function multilineWorkflowStep(name, command) {
  return `      - name: ${name}
        run: |
${command
  .split("\n")
  .map((line) => `          ${line}`)
  .join("\n")}`;
}

async function readPackageJsonIfPresent(dir) {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

async function writePackageJson(dir, packageJson) {
  await writeFile(path.join(dir, "package.json"), JSON.stringify(packageJson, null, 2) + "\n", "utf8");
}

async function addLockfileVerifyScript(dir) {
  const packageJson = await readPackageJsonIfPresent(dir);
  if (!packageJson) return;
  packageJson.scripts ??= {};
  packageJson.scripts["verify:lockfile"] = "node scripts/verify-lockfile-sources.mjs";
  await writePackageJson(dir, packageJson);
}

function renderCiReplacements({ packageManager, template, packageJson, codeOwner }) {
  const setupPm = setupPackageManagerStep(packageManager);
  const needsBunRuntime = template === "bun-basic" && packageManager !== "bun";
  const audit = auditCommand(packageManager);
  const buildStep = hasPackageScript(packageJson, "build") ? workflowStep("Build", runScriptCommand(packageManager, "build")) : "";
  const auditStep = audit ? workflowStep("Audit production dependencies", audit) : "";
  const tagVersionCheck = `set -eu
tag_version="\${GITHUB_REF_NAME#v}"
pkg_version="$(node -p "require('./package.json').version")"
if [ "$tag_version" != "$pkg_version" ]; then
  echo "::error::Tag $GITHUB_REF_NAME does not match package.json version $pkg_version"
  exit 1
fi`;

  return new Map([
    ["__CODE_OWNER__", codeOwner],
    ["__SETUP_PACKAGE_MANAGER_STEP__", setupPm],
    ["__SETUP_BUN_RUNTIME_STEP__", needsBunRuntime ? setupBunStep() : ""],
    ["__INSTALL_COMMAND__", installCommand(packageManager)],
    ["__VERIFY_LOCKFILE_COMMAND__", runScriptCommand(packageManager, "verify:lockfile")],
    ["__TYPECHECK_COMMAND__", runScriptCommand(packageManager, "typecheck")],
    ["__TEST_COMMAND__", runScriptCommand(packageManager, "test")],
    ["__BUILD_STEP__", buildStep],
    ["__AUDIT_STEP__", auditStep],
    ["__TAG_VERSION_CHECK_STEP__", multilineWorkflowStep("Verify tag matches package.json version", tagVersionCheck)],
  ]);
}

async function replacePlaceholdersInTree(dir, replacements) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await replacePlaceholdersInTree(full, replacements);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!CI_PLACEHOLDER_EXTENSIONS.has(path.extname(entry.name)) && !CI_PLACEHOLDER_FILES.has(entry.name)) {
      continue;
    }
    const raw = await readFile(full, "utf8");
    let next = raw;
    for (const [placeholder, value] of replacements) {
      next = next.replaceAll(placeholder, value);
    }
    if (next !== raw) await writeFile(full, next, "utf8");
  }
}

async function copyCiBundle(targetDir, template, packageManager, skipPackageManager, codeOwner) {
  const flavor = skipPackageManager ? "deno" : "node";
  const sourceDir = path.join(CI_TEMPLATES_DIR, flavor);
  if (!existsSync(sourceDir)) {
    throw new Error(`CI template bundle "${flavor}" is missing from this CLI build.`);
  }
  await copyTemplate(sourceDir, targetDir);

  const candidate = codeOwner?.trim() ?? "";
  if (candidate && !VALID_CODE_OWNER.test(candidate)) {
    throw new Error(
      `Invalid --code-owner "${candidate}". Use a GitHub handle (@user), a team (@org/team), or an email address.`,
    );
  }
  const owner = candidate || "@your-org/security-team";
  if (skipPackageManager) {
    await replacePlaceholdersInTree(targetDir, new Map([["__CODE_OWNER__", owner]]));
    return;
  }

  await addLockfileVerifyScript(targetDir);
  const packageJson = await readPackageJsonIfPresent(targetDir);
  await replacePlaceholdersInTree(
    targetDir,
    renderCiReplacements({ packageManager, template, packageJson, codeOwner: owner }),
  );
}

/**
 * `--minimal` post-processor.
 *
 * Templates ship with optional sections fenced by line comments:
 *
 *   // daloy-minimal:strip-start <tag>
 *   ...
 *   // daloy-minimal:strip-end <tag>
 *
 * Markdown files can use equivalent HTML comments:
 *
 *   <!-- daloy-minimal:strip-start <tag> -->
 *   ...
 *   <!-- daloy-minimal:strip-end <tag> -->
 *
 * When the user passes `--minimal`, this walks the scaffolded source files
 * and deletes those blocks (including the sentinel lines themselves) so
 * the resulting project ships only the health route plus the bare
 * framework bootstrap. We deliberately keep matching to text files with
 * known source extensions so the stripper never touches binary assets.
 */
async function stripMinimalSections(dir) {
  const stripPatterns = [
    /^[ \t]*\/\/[ \t]*daloy-minimal:strip-start\b[\s\S]*?^[ \t]*\/\/[ \t]*daloy-minimal:strip-end\b.*\n?/gm,
    /^[ \t]*<!--[ \t]*daloy-minimal:strip-start\b[\s\S]*?^[ \t]*<!--[ \t]*daloy-minimal:strip-end\b.*?-->[ \t]*\n?/gm,
  ];
  let stripped = 0;
  await walk(dir);
  return stripped;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!MINIMAL_STRIP_EXTENSIONS.has(path.extname(entry.name))) continue;
      const raw = await readFile(full, "utf8");
      if (!raw.includes("daloy-minimal:strip-start")) continue;
      const next = stripPatterns.reduce((current, pattern) => current.replace(pattern, ""), raw);
      if (next !== raw) {
        await writeFile(full, next, "utf8");
        stripped += 1;
      }
    }
  }
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    proc.on("exit", (code) => resolve(code ?? 0));
    proc.on("error", () => resolve(1));
  });
}

// Same as `run`, but captures output so the spinner can stay clean. The
// transcript tail is returned so callers can replay useful failure context
// without buffering unbounded package-manager output in memory.
function runQuiet(cmd, args, cwd) {
  return new Promise((resolve) => {
    const maxOutputBytes = 64 * 1024;
    let output = "";
    const appendOutput = (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > maxOutputBytes) output = output.slice(-maxOutputBytes);
    };
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    proc.stdout.on("data", appendOutput);
    proc.stderr.on("data", appendOutput);
    proc.on("exit", (code) => resolve({ code: code ?? 0, output }));
    proc.on("error", (err) => resolve({ code: 1, output: String(err?.message ?? err) }));
  });
}

// ----------------------------------------------------------------------------
// Prompt primitives.
//
// `ask`/`askYesNo` use readline for resilience (paste, history, multi-line
// input). `askChoice` upgrades to raw-mode arrow-key navigation when stdin is
// a TTY, with a numbered fallback used by the readline-driven tests.
// ----------------------------------------------------------------------------

function printPromptHeader(question) {
  console.log(`${color(COLORS.cyan, SYMBOLS.stepActive)}  ${color(COLORS.bold, question)}`);
}

function printPromptResult(question, value) {
  console.log(`${color(COLORS.green, SYMBOLS.stepDone)}  ${question}  ${color(COLORS.dim, SYMBOLS.arrow)} ${color(COLORS.cyan, value)}`);
}

async function ask(rl, question, defaultValue) {
  printPromptHeader(question);
  const hint = defaultValue !== undefined ? color(COLORS.dim, ` (default: ${defaultValue})`) : "";
  const answer = (await rl.question(`${BAR}  ${color(COLORS.gray, SYMBOLS.pointer)}${hint} `)).trim();
  const value = answer.length === 0 ? defaultValue : answer;
  // readline already echoed the prompt + answer line; emit a final summary
  // line on the rail so the transcript reads cleanly after scroll-back.
  printRailGap();
  return value;
}

async function askYesNo(rl, question, defaultYes) {
  printPromptHeader(question);
  const def = defaultYes ? "Y/n" : "y/N";
  const answer = (await rl.question(`${BAR}  ${color(COLORS.gray, SYMBOLS.pointer)} ${color(COLORS.dim, `(${def})`)} `))
    .trim()
    .toLowerCase();
  printRailGap();
  if (answer.length === 0) return defaultYes;
  return answer === "y" || answer === "yes";
}

function optionValue(option) {
  return typeof option === "string" ? option : option.value;
}

function optionTitle(option) {
  return typeof option === "string" ? option : option.title;
}

function optionDescription(option) {
  return typeof option === "string" ? "" : option.description ?? "";
}

// Arrow-key powered choice prompt. Falls back to numbered input whenever raw
// mode is unavailable (CI, piped stdin, integration tests).
async function askChoice(rl, question, choices, defaultChoice) {
  const canRawMode = process.stdin.isTTY && typeof process.stdin.setRawMode === "function";
  if (!canRawMode) return askChoiceNumbered(rl, question, choices, defaultChoice);

  printPromptHeader(question);
  printRailLine(color(COLORS.dim, `Use \u2191 \u2193 to navigate, Enter to confirm, type a number to jump.`));

  let index = Math.max(
    0,
    choices.findIndex((choice) => optionValue(choice) === defaultChoice),
  );
  const titleWidth = Math.max(...choices.map((choice) => optionTitle(choice).length));
  const valueWidth = Math.max(...choices.map((choice) => optionValue(choice).length));

  function render(active) {
    return choices
      .map((choice, i) => {
        const isActive = i === active;
        const isDefault = optionValue(choice) === defaultChoice;
        const marker = isActive ? color(COLORS.cyan, SYMBOLS.radioOn) : color(COLORS.gray, SYMBOLS.radioOff);
        const titleRaw = optionTitle(choice).padEnd(titleWidth);
        const valueRaw = optionValue(choice).padEnd(valueWidth);
        const title = isActive ? color(COLORS.bold + COLORS.cyan, titleRaw) : color(COLORS.white, titleRaw);
        const value = color(COLORS.dim, `(${valueRaw})`);
        const description = optionDescription(choice);
        const descColored = isActive ? color(COLORS.cyan, description) : color(COLORS.dim, description);
        const recommended = isDefault ? color(COLORS.green, `  ${SYMBOLS.star} recommended`) : "";
        return `${BAR}  ${marker} ${title}  ${value}  ${descColored}${recommended}`;
      })
      .join("\n");
  }

  // Pause readline so it doesn't fight us for stdin while we're in raw mode.
  rl.pause();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  // Initial render
  process.stdout.write(render(index) + "\n");

  const result = await new Promise((resolve, reject) => {
    function rerender(newIndex) {
      // Move cursor up `choices.length` lines, clear them, redraw.
      process.stdout.write(`\x1b[${choices.length}A`);
      for (let i = 0; i < choices.length; i += 1) process.stdout.write("\x1b[2K\n");
      process.stdout.write(`\x1b[${choices.length}A`);
      process.stdout.write(render(newIndex) + "\n");
    }
    function cleanup() {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    function onData(chunk) {
      const data = chunk.toString();
      // Ctrl+C / Ctrl+D — abort cleanly
      if (data === "\u0003" || data === "\u0004") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("Cancelled"));
        return;
      }
      // Enter
      if (data === "\r" || data === "\n") {
        cleanup();
        resolve(optionValue(choices[index]));
        return;
      }
      // Number shortcut (1..9)
      if (/^[1-9]$/.test(data)) {
        const n = Number.parseInt(data, 10);
        if (n >= 1 && n <= choices.length) {
          index = n - 1;
          rerender(index);
        }
        return;
      }
      // Arrow keys / vim keys
      if (data === "\u001b[A" || data === "k") {
        index = (index - 1 + choices.length) % choices.length;
        rerender(index);
      } else if (data === "\u001b[B" || data === "j") {
        index = (index + 1) % choices.length;
        rerender(index);
      } else if (data === "\u001b[H") {
        index = 0;
        rerender(index);
      } else if (data === "\u001b[F") {
        index = choices.length - 1;
        rerender(index);
      }
    }
    process.stdin.on("data", onData);
  });

  // Replace the rendered list with a single confirmation line.
  // Rendered block was choices.length lines; we also printed the hint line
  // above the list. Move up and clear them.
  const linesToClear = choices.length + 1; // hint + list
  process.stdout.write(`\x1b[${linesToClear}A`);
  for (let i = 0; i < linesToClear; i += 1) process.stdout.write("\x1b[2K\n");
  process.stdout.write(`\x1b[${linesToClear}A`);

  // Also clear the prompt header we printed at the very top.
  process.stdout.write("\x1b[1A\x1b[2K");

  printPromptResult(question, result);
  printRailGap();
  rl.resume();
  return result;
}

async function askChoiceNumbered(rl, question, choices, defaultChoice) {
  printPromptHeader(question);
  const titleWidth = Math.max(...choices.map((choice) => optionTitle(choice).length));
  for (let i = 0; i < choices.length; i += 1) {
    const choice = choices[i];
    const isDefault = optionValue(choice) === defaultChoice;
    const idx = color(COLORS.dim, `${String(i + 1).padStart(2, " ")})`);
    const title = color(COLORS.white, optionTitle(choice).padEnd(titleWidth));
    const value = color(COLORS.dim, `(${optionValue(choice)})`);
    const description = color(COLORS.dim, optionDescription(choice));
    const recommended = isDefault ? color(COLORS.green, `  ${SYMBOLS.star} recommended`) : "";
    printRailLine(`${idx} ${title}  ${value}  ${description}${recommended}`);
  }
  const raw = (await rl.question(`${BAR}  ${color(COLORS.gray, SYMBOLS.pointer)} `)).trim();
  printRailGap();
  if (raw.length === 0) return defaultChoice;
  const asNumber = Number.parseInt(raw, 10);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= choices.length) {
    return optionValue(choices[asNumber - 1]);
  }
  if (choices.some((choice) => optionValue(choice) === raw)) return raw;
  console.error(`${BAR}  ${color(COLORS.red, `Invalid choice. Pick one of: ${choices.map(optionValue).join(", ")}`)}`);
  return askChoiceNumbered(rl, question, choices, defaultChoice);
}

function logStep(message, detail) {
  const suffix = detail ? color(COLORS.dim, ` \u2014 ${detail}`) : "";
  console.log(`${color(COLORS.green, SYMBOLS.success)}  ${message}${suffix}`);
}

function logWarn(message) {
  console.warn(`${color(COLORS.yellow, SYMBOLS.warn)}  ${color(COLORS.yellow, message)}`);
}

function logError(message) {
  console.error(`${color(COLORS.red, SYMBOLS.error)}  ${color(COLORS.red, message)}`);
}

// ----------------------------------------------------------------------------
// Spinner — tiny braille animation for long-running steps (e.g. install).
// ----------------------------------------------------------------------------

const SPINNER_FRAMES = SUPPORTS_UNICODE
  ? ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]
  : ["|", "/", "-", "\\"];

function createSpinner(initialMessage) {
  let message = initialMessage;
  let frame = 0;
  let timer = null;
  let active = false;
  function render() {
    if (!process.stdout.isTTY) return;
    process.stdout.write(`\r\x1b[2K${color(COLORS.cyan, SPINNER_FRAMES[frame])}  ${message}`);
    frame = (frame + 1) % SPINNER_FRAMES.length;
  }
  return {
    start(text) {
      if (text) message = text;
      active = true;
      if (process.stdout.isTTY) {
        timer = setInterval(render, 80);
        render();
      } else {
        console.log(`${color(COLORS.cyan, SYMBOLS.stepActive)}  ${message}`);
      }
    },
    update(text) {
      message = text;
      if (active && process.stdout.isTTY) render();
    },
    stop(text, ok = true) {
      if (timer) clearInterval(timer);
      timer = null;
      active = false;
      const symbol = ok
        ? color(COLORS.green, SYMBOLS.success)
        : color(COLORS.red, SYMBOLS.error);
      const finalMessage = text ?? message;
      if (process.stdout.isTTY) {
        process.stdout.write(`\r\x1b[2K${symbol}  ${finalMessage}\n`);
      } else {
        console.log(`${symbol}  ${finalMessage}`);
      }
    },
  };
}

function printSummary({ projectName, template, packageManager, installDeps, skipPackageManager, withCi }) {
  const templateMeta = TEMPLATE_OPTIONS.find((option) => option.value === template);
  const templateLabel = templateMeta ? `${templateMeta.title} ${color(COLORS.dim, `(${template})`)}` : template;
  const summaryLines = [
    `${color(COLORS.green, SYMBOLS.sparkle)}  ${color(COLORS.bold, "Your DaloyJS project is ready!")}`,
    "",
    `${color(COLORS.gray, "Project   ")} ${color(COLORS.bold, projectName)}`,
    `${color(COLORS.gray, "Template  ")} ${templateLabel}`,
  ];
  if (skipPackageManager) {
    summaryLines.push(`${color(COLORS.gray, "Runtime   ")} ${color(COLORS.cyan, template === "deno-basic" ? "Deno" : "runtime")}`);
  } else {
    summaryLines.push(`${color(COLORS.gray, "Manager   ")} ${color(COLORS.cyan, packageManager)}`);
  }
  if (withCi) {
    summaryLines.push(`${color(COLORS.gray, "Security  ")} ${color(COLORS.cyan, "GitHub CI bundle")}`);
  }
  console.log("");
  console.log(renderBox(summaryLines, { accent: COLORS.green }));
  console.log("");

  const arrow = color(COLORS.cyan, SYMBOLS.arrow);
  console.log(`${color(COLORS.bold, "Next steps")}`);
  console.log(`  ${arrow} ${color(COLORS.cyan, `cd ${projectName}`)}`);
  if (skipPackageManager) {
    console.log(`  ${arrow} ${color(COLORS.cyan, "deno task dev")}`);
  } else {
    if (!installDeps) console.log(`  ${arrow} ${color(COLORS.cyan, `${packageManager} install`)}`);
    console.log(`  ${arrow} ${color(COLORS.cyan, `${packageManager} run dev`)}`);
  }

  console.log("");
  console.log(`${color(COLORS.bold, "Useful commands")}`);
  if (skipPackageManager) {
    console.log(`  ${color(COLORS.gray, SYMBOLS.pointer)} ${color(COLORS.dim, "deno task typecheck")}`);
    console.log(`  ${color(COLORS.gray, SYMBOLS.pointer)} ${color(COLORS.dim, "deno task test")}`);
    console.log(`  ${color(COLORS.gray, SYMBOLS.pointer)} ${color(COLORS.dim, "deno task gen:openapi")}`);
  } else {
    console.log(`  ${color(COLORS.gray, SYMBOLS.pointer)} ${color(COLORS.dim, `${packageManager} run typecheck`)}`);
    console.log(`  ${color(COLORS.gray, SYMBOLS.pointer)} ${color(COLORS.dim, `${packageManager} test`)}`);
    if (template === "node-basic" || template === "bun-basic") {
      console.log(`  ${color(COLORS.gray, SYMBOLS.pointer)} ${color(COLORS.dim, `${packageManager} run gen`)}`);
    }
  }

  console.log("");
  console.log(`${color(COLORS.gray, "Docs:")}   ${color(COLORS.cyan, "https://daloyjs.dev/docs")}`);
  console.log(`${color(COLORS.gray, "Issues:")} ${color(COLORS.cyan, "https://github.com/daloyjs/daloy/issues")}`);
  console.log("");
  console.log(`${color(COLORS.magenta, SYMBOLS.sparkle)}  ${color(COLORS.bold, "Happy shipping!")}\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (opts.version) {
    console.log(await readPkgVersion());
    process.exit(0);
  }
  if (opts.listTemplates) {
    printTemplates();
    process.exit(0);
  }

  printBanner(await readPkgVersion());

  const detectedPm = detectPackageManager();
  const interactive = !opts.yes && process.stdin.isTTY && process.stdout.isTTY;
  const rl = interactive ? createInterface({ input, output }) : null;

  if (interactive) {
    printIntro("Let's set up your DaloyJS project");
  }

  try {
    let projectName = opts.projectName;
    if (!projectName) {
      if (rl) {
        while (true) {
          const candidate = await ask(rl, "Project name?", "my-daloy-app");
          const valid = validateProjectName(candidate);
          if (valid === true) {
            projectName = candidate;
            break;
          }
          logError(valid);
        }
      } else {
        projectName = "my-daloy-app";
      }
    }
    const nameCheck = validateProjectName(projectName);
    if (nameCheck !== true) {
      logError(nameCheck);
      process.exit(1);
    }

    let template = opts.template;
    if (!template) {
      template = rl ? await askChoice(rl, "Choose a starter template:", TEMPLATE_OPTIONS, "node-basic") : "node-basic";
    }
    if (!TEMPLATES.includes(template)) {
      logError(`Unknown template "${template}". Available: ${TEMPLATES.join(", ")}`);
      process.exit(1);
    }

    const templateDir = path.join(TEMPLATES_DIR, template);
    if (!existsSync(templateDir)) {
      logError(`Template "${template}" is missing from this CLI build.`);
      process.exit(1);
    }

    const targetDir = path.resolve(process.cwd(), projectName);
    if (existsSync(targetDir)) {
      const empty = await isDirEmpty(targetDir);
      if (!empty && !opts.force) {
        logError(`Directory ${projectName} is not empty. Re-run with --force to overwrite.`);
        process.exit(1);
      }
    }

    let packageManager = opts.packageManager;
    const skipPackageManager = NO_PACKAGE_JSON_TEMPLATES.has(template);
    if (!packageManager) {
      if (skipPackageManager) {
        packageManager = "pnpm"; // ignored for runtime-only templates
      } else {
        packageManager = rl
          ? await askChoice(rl, "Choose a package manager:", PACKAGE_MANAGER_OPTIONS, detectedPm)
          : detectedPm;
      }
    }
    if (!PACKAGE_MANAGERS.includes(packageManager)) {
      logError(`Unknown --package-manager "${packageManager}". Use one of: ${PACKAGE_MANAGERS.join(", ")}`);
      process.exit(1);
    }

    let installDeps = opts.install;
    if (installDeps === undefined) {
      if (skipPackageManager) {
        installDeps = false;
      } else {
        installDeps = rl ? await askYesNo(rl, `Install dependencies with ${packageManager}?`, true) : false;
      }
    }

    let initGit = opts.git;
    if (initGit === undefined) {
      initGit = rl ? await askYesNo(rl, "Initialize a git repository?", true) : false;
    }

    let withCi = opts.ci;
    if (withCi === undefined) {
      withCi = rl ? await askYesNo(rl, "Add hardened GitHub Actions and security files?", false) : false;
    }

    rl?.close();

    if (interactive) {
      printOutro(color(COLORS.dim, "Configuration locked in. Building your project\u2026"));
    }
    console.log("");
    console.log(`${color(COLORS.cyan, SYMBOLS.sparkle)}  ${color(COLORS.bold, "Scaffolding your project")}`);
    console.log("");

    await mkdir(targetDir, { recursive: true });
    await copyTemplate(templateDir, targetDir);
    logStep("Template copied", template);
    if (opts.minimal) {
      const count = await stripMinimalSections(targetDir);
      logStep("Minimal mode applied", `${count} file${count === 1 ? "" : "s"} trimmed`);
    }
    if (!skipPackageManager) {
      await patchPackageJson(targetDir, projectName, packageManager);
      logStep("Package metadata written", projectName);
      await patchTemplateTextFiles(targetDir, packageManager);
      await normalizePackageManagerFiles(targetDir, packageManager);
      if (packageManager !== "pnpm") {
        logStep("Package-manager config normalized", packageManager);
      }
    }

    if (withCi) {
      await copyCiBundle(targetDir, template, packageManager, skipPackageManager, opts.codeOwner);
      logStep("GitHub security bundle added", skipPackageManager ? "deno" : packageManager);
    }

    if (initGit) {
      const code = await run("git", ["init", "--quiet"], targetDir);
      if (code === 0) {
        logStep("Git repository initialized");
      } else {
        logWarn("git init failed; continuing");
      }
    }

    if (installDeps) {
      const spinner = createSpinner(`Installing dependencies with ${color(COLORS.cyan, packageManager)}\u2026`);
      spinner.start();
      const { code, output: installOutput } = await runQuiet(packageManager, ["install"], targetDir);
      if (code !== 0) {
        spinner.stop(`${packageManager} install failed (exit ${code})`, false);
        // Replay the captured output so the user can see what went wrong.
        const tail = installOutput.split(/\r?\n/).slice(-40).join("\n");
        if (tail.trim().length > 0) {
          console.error(color(COLORS.dim, tail));
        }
        logWarn(`Retry inside ${projectName} with: ${packageManager} install`);
      } else {
        spinner.stop(`Installed dependencies with ${color(COLORS.cyan, packageManager)}`);
      }
    }

    printSummary({ projectName, template, packageManager, installDeps, skipPackageManager, withCi });
  } catch (err) {
    rl?.close();
    if (err && err.message === "Cancelled") {
      console.log("");
      logWarn("Cancelled. No project was created.");
      process.exit(130);
    }
    logError(`Failed: ${(err && err.message) || err}`);
    process.exit(1);
  }
}

await main();
