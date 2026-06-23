import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Hey API codegen config used by exercise 5 (4-hour) and exercise 8 (8-hour).
 *
 * Run `pnpm gen` while a workshop exercise is serving on port 3000.
 * It will hit /openapi.json and write the typed SDK to ./generated/client/.
 *
 * Docs: https://daloyjs.dev/docs/clients
 */
export default defineConfig({
  input: "http://localhost:3000/openapi.json",
  output: {
    path: "./generated/client",
    postProcess: ["prettier"],
  },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk", "zod"],
});
