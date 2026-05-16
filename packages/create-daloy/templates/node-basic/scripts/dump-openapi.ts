import { writeFile, mkdir } from "node:fs/promises";
import { generateOpenAPI } from "@daloyjs/core/openapi";
import { buildApp } from "../src/build-app.js";

// Build a fresh app from the factory so the spec dump never starts the HTTP
// listener as a side effect. Keep this script deterministic so codegen output
// is stable in CI.

async function main() {
  const app = buildApp();
  const doc = generateOpenAPI(app, {
    info: { title: "My Daloy API", version: "0.0.1" },
    servers: [{ url: "http://localhost:3000" }],
  });
  await mkdir("generated", { recursive: true });
  await writeFile("generated/openapi.json", JSON.stringify(doc, null, 2));
  console.log("wrote generated/openapi.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
