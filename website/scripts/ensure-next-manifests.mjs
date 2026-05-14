import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const nextDir = path.join(process.cwd(), ".next");
const routesManifest = path.join(nextDir, "routes-manifest.json");
const deterministicRoutesManifest = path.join(nextDir, "routes-manifest-deterministic.json");

if (existsSync(routesManifest) && !existsSync(deterministicRoutesManifest)) {
  copyFileSync(routesManifest, deterministicRoutesManifest);
}