import { serve } from "@daloyjs/core/bun";
import { buildApp } from "./build-app.ts";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

serve(app, { port });
console.log(`DaloyJS (Bun) listening on http://localhost:${port}`);
// daloy-minimal:strip-start docs
console.log(`  Swagger UI:   http://localhost:${port}/docs`);
console.log(`  OpenAPI JSON: http://localhost:${port}/openapi.json`);
// daloy-minimal:strip-end docs
console.log(`  Health:       http://localhost:${port}/healthz`);

export default app;
