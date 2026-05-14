/**
 * @hey-api/openapi-ts configuration.
 *
 * Reads the OpenAPI 3.1 spec produced by `pnpm gen:openapi` and emits a
 * fully typed TypeScript client + Zod-style runtime schemas under
 * `generated/client/`.
 *
 * Docs: https://heyapi.dev/openapi-ts/get-started
 */
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./generated/openapi.json",
  output: {
    path: "./generated/client",
    postProcess: ["prettier"],
  },
  plugins: [
    "@hey-api/client-fetch",
    "@hey-api/typescript",
    "@hey-api/sdk",
  ],
});
