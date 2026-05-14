import { serve } from "@daloyjs/core/node";
import { buildApp } from "./build-app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

serve(app, { port });
console.log(`DaloyJS listening on http://localhost:${port}`);
console.log(`  Swagger UI:   http://localhost:${port}/docs`);
console.log(`  OpenAPI JSON: http://localhost:${port}/openapi.json`);
console.log(`  Health:       http://localhost:${port}/healthz`);

export default app;
