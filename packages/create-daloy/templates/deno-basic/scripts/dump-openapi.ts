import { generateOpenAPI } from "@daloyjs/core/openapi";
import { buildApp } from "../src/build-app.ts";

const app = buildApp();
const doc = generateOpenAPI(app, {
  info: { title: "My Daloy Deno API", version: "0.0.1" },
  servers: [{ url: "http://localhost:3000" }],
});

await Deno.mkdir("generated", { recursive: true });
await Deno.writeTextFile("generated/openapi.json", JSON.stringify(doc, null, 2));
console.log("wrote generated/openapi.json");
