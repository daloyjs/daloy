#!/usr/bin/env node
// create-daloy — scaffold a new DaloyJS project.
// Zero runtime dependencies; uses only Node built-ins.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile, copyFile, rename } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const TEMPLATES_DIR = path.join(PKG_ROOT, "templates");

const TEMPLATES = ["node-basic", "cloudflare-worker"];
const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"];

const RENAME_ON_COPY = new Map([
  ["_gitignore", ".gitignore"],
  ["_npmrc", ".npmrc"],
  ["_env.example", ".env.example"],
]);

const COLORS = process.stdout.isTTY
  ? {
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      cyan: "\x1b[36m",
      green: "\x1b[32m",
      red: "\x1b[31m",
      yellow: "\x1b[33m",
    }
  : { reset: "", bold: "", dim: "", cyan: "", green: "", red: "", yellow: "" };

function color(code, s) {
  return `${code}${s}${COLORS.reset}`;
}

function printHelp() {
  console.log(`${color(COLORS.bold, "create-daloy")} — scaffold a DaloyJS project

Usage:
  pnpm create daloy@latest [project-name] [options]
  npm  create daloy@latest [project-name] [options]

Options:
  --template <name>          ${TEMPLATES.join(" | ")}  (default: node-basic)
  --package-manager <pm>     ${PACKAGE_MANAGERS.join(" | ")}  (default: pnpm)
  --install / --no-install   Install dependencies after scaffolding.
  --git / --no-git           Initialize a git repository.
  --force                    Overwrite an existing non-empty directory.
  --yes, -y                  Accept all defaults; never prompt.
  --help, -h                 Print this help.
  --version, -v              Print version.
`);
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
  };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--version" || a === "-v") out.version = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--force") out.force = true;
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
      console.error(color(COLORS.red, `Unknown argument: ${a}`));
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

async function patchPackageJson(dir, projectName) {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return;
  const raw = await readFile(file, "utf8");
  const json = JSON.parse(raw);
  json.name = projectName.startsWith("@") ? projectName : projectName.toLowerCase();
  await writeFile(file, JSON.stringify(json, null, 2) + "\n", "utf8");
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    proc.on("exit", (code) => resolve(code ?? 0));
    proc.on("error", () => resolve(1));
  });
}

async function ask(rl, question, defaultValue) {
  const suffix = defaultValue !== undefined ? color(COLORS.dim, ` (${defaultValue})`) : "";
  const answer = (await rl.question(`${color(COLORS.cyan, "?")} ${question}${suffix} `)).trim();
  return answer.length === 0 ? defaultValue : answer;
}

async function askYesNo(rl, question, defaultYes) {
  const def = defaultYes ? "Y/n" : "y/N";
  const answer = (await rl.question(`${color(COLORS.cyan, "?")} ${question} ${color(COLORS.dim, `(${def})`)} `))
    .trim()
    .toLowerCase();
  if (answer.length === 0) return defaultYes;
  return answer === "y" || answer === "yes";
}

async function askChoice(rl, question, choices, defaultChoice) {
  const list = choices
    .map((c, i) => `  ${color(COLORS.dim, `${i + 1})`)} ${c}${c === defaultChoice ? color(COLORS.dim, " (default)") : ""}`)
    .join("\n");
  console.log(`${color(COLORS.cyan, "?")} ${question}\n${list}`);
  const raw = (await rl.question(`  > `)).trim();
  if (raw.length === 0) return defaultChoice;
  const asNumber = Number.parseInt(raw, 10);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= choices.length) {
    return choices[asNumber - 1];
  }
  if (choices.includes(raw)) return raw;
  console.error(color(COLORS.red, `Invalid choice. Pick one of: ${choices.join(", ")}`));
  return askChoice(rl, question, choices, defaultChoice);
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

  console.log(color(COLORS.bold, "\n  create-daloy"));
  console.log(color(COLORS.dim, `  https://daloyjs.dev\n`));

  const detectedPm = detectPackageManager();
  const interactive = !opts.yes && process.stdin.isTTY && process.stdout.isTTY;
  const rl = interactive ? createInterface({ input, output }) : null;

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
          console.error(color(COLORS.red, `  ${valid}`));
        }
      } else {
        projectName = "my-daloy-app";
      }
    }
    const nameCheck = validateProjectName(projectName);
    if (nameCheck !== true) {
      console.error(color(COLORS.red, nameCheck));
      process.exit(1);
    }

    let template = opts.template;
    if (!template) {
      template = rl ? await askChoice(rl, "Pick a template:", TEMPLATES, "node-basic") : "node-basic";
    }
    if (!TEMPLATES.includes(template)) {
      console.error(color(COLORS.red, `Unknown template "${template}". Available: ${TEMPLATES.join(", ")}`));
      process.exit(1);
    }

    const templateDir = path.join(TEMPLATES_DIR, template);
    if (!existsSync(templateDir)) {
      console.error(color(COLORS.red, `Template "${template}" is missing from this CLI build.`));
      process.exit(1);
    }

    const targetDir = path.resolve(process.cwd(), projectName);
    if (existsSync(targetDir)) {
      const empty = await isDirEmpty(targetDir);
      if (!empty && !opts.force) {
        console.error(
          color(
            COLORS.red,
            `Directory ${projectName} is not empty. Re-run with --force to overwrite.`,
          ),
        );
        process.exit(1);
      }
    }

    let packageManager = opts.packageManager ?? detectedPm;
    if (!PACKAGE_MANAGERS.includes(packageManager)) {
      console.error(
        color(COLORS.red, `Unknown --package-manager "${packageManager}". Use one of: ${PACKAGE_MANAGERS.join(", ")}`),
      );
      process.exit(1);
    }

    let installDeps = opts.install;
    if (installDeps === undefined) {
      installDeps = rl ? await askYesNo(rl, `Install dependencies with ${packageManager}?`, true) : false;
    }

    let initGit = opts.git;
    if (initGit === undefined) {
      initGit = rl ? await askYesNo(rl, "Initialize a git repository?", true) : false;
    }

    rl?.close();

    console.log(color(COLORS.dim, `\n  Scaffolding ${color(COLORS.bold, projectName)} from template ${color(COLORS.bold, template)}...`));

    await mkdir(targetDir, { recursive: true });
    await copyTemplate(templateDir, targetDir);
    await patchPackageJson(targetDir, projectName);

    if (initGit) {
      const code = await run("git", ["init", "--quiet"], targetDir);
      if (code === 0) {
        console.log(color(COLORS.green, "  ✓ git repository initialized"));
      } else {
        console.warn(color(COLORS.yellow, "  ! git init failed; continuing"));
      }
    }

    if (installDeps) {
      console.log(color(COLORS.dim, `  Installing dependencies with ${packageManager}...`));
      const code = await run(packageManager, ["install"], targetDir);
      if (code !== 0) {
        console.warn(
          color(COLORS.yellow, `  ! ${packageManager} install exited with code ${code}; you can retry inside ${projectName}.`),
        );
      } else {
        console.log(color(COLORS.green, "  ✓ dependencies installed"));
      }
    }

    console.log(color(COLORS.green, `\n  Done.`));
    console.log(`\n  Next steps:\n`);
    console.log(`    cd ${projectName}`);
    if (!installDeps) console.log(`    ${packageManager} install`);
    console.log(`    ${packageManager} run dev`);
    console.log("");
    console.log(color(COLORS.dim, "  Docs: https://daloyjs.dev/docs"));
    console.log(color(COLORS.dim, "  Issues: https://github.com/daloyjs/daloy/issues\n"));
  } catch (err) {
    rl?.close();
    console.error(color(COLORS.red, `\n  Failed: ${(err && err.message) || err}`));
    process.exit(1);
  }
}

await main();
