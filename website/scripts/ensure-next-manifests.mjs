import { copyFileSync, cpSync, existsSync, lstatSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

const nextDir = path.join(process.cwd(), ".next");
const routesManifest = path.join(nextDir, "routes-manifest.json");
const deterministicRoutesManifest = path.join(nextDir, "routes-manifest-deterministic.json");
const parentNextDir = path.join(process.cwd(), "..", ".next");
const nestedAppOnVercel =
  process.env.VERCEL === "1" &&
  existsSync(path.join(process.cwd(), "next.config.ts")) &&
  existsSync(path.join(process.cwd(), "..", "package.json"));

if (existsSync(routesManifest) && !existsSync(deterministicRoutesManifest)) {
  copyFileSync(routesManifest, deterministicRoutesManifest);
}

if (nestedAppOnVercel && nextDir !== parentNextDir && !existsSync(parentNextDir)) {
  try {
    symlinkSync(nextDir, parentNextDir, "dir");
  } catch {
    cpSync(nextDir, parentNextDir, {
      recursive: true,
      filter(source) {
        return !source.includes(`${path.sep}cache`);
      },
    });
  }
} else if (nestedAppOnVercel && existsSync(parentNextDir)) {
  const parentNextStats = lstatSync(parentNextDir);

  if (!parentNextStats.isSymbolicLink() && !existsSync(path.join(parentNextDir, "routes-manifest-deterministic.json"))) {
    rmSync(parentNextDir, { force: true, recursive: true });

    try {
      symlinkSync(nextDir, parentNextDir, "dir");
    } catch {
      cpSync(nextDir, parentNextDir, {
        recursive: true,
        filter(source) {
          return !source.includes(`${path.sep}cache`);
        },
      });
    }
  }
}