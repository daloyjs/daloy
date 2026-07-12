// TODO:
// 1. Create a new App instance with title, version, and `docs: true` so
//    GET /docs (Scalar UI) and GET /openapi.json are auto-mounted.
// 2. Register a single GET /health route that returns `{ status: "ok" }`.
// 3. Boot the server on port 3000 using the Node adapter.
//
// Docs: https://daloyjs.dev/docs/getting-started

import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const app = new App({
	title: "Workshop API",
	version: "0.1.0",
	openapi: { info: { title: "Workshop API", version: "0.1.0" } },
	docs: true,
});

app.get(
	"/health",
	{
		operationId: "getHealth",
		tags: ["Meta"],
		responses: {
			200: {
				description: "Service is healthy",
				body: z.object({ status: z.literal("ok") }),
			},
		},
	},
	async () => ({ status: 200 as const, body: { status: "ok" as const } }),
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/health");
console.log("→ http://localhost:3000/docs");
