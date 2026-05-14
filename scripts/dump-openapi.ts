/**
 * Materialize the OpenAPI 3.1 document for the example app to disk so that
 * @hey-api/openapi-ts (or any other OpenAPI generator) can consume it.
 *
 * Run: `pnpm gen:openapi` → produces `generated/openapi.json`.
 *
 * In a real project, point this at your own `app` instance.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateOpenAPI } from "../src/openapi.js";
import { buildExampleApp } from "../examples/build-app.js";

async function main() {
  const app = buildExampleApp();
  const doc = generateOpenAPI(app, {
    info: { title: "Bookstore API", version: "1.0.0" },
    servers: [{ url: "http://localhost:3000" }],
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  });
  const out = resolve("generated/openapi.json");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(doc, null, 2));
  console.log(`Wrote ${out}  (${app.routes.length} routes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
