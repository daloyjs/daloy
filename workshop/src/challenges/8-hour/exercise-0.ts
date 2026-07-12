// 8-HOUR · Exercise 0 — Workshop Setup
//
// Same goal as 4-hour exercise 0 (bootstrap App + /health + /docs + /openapi.json),
// but you ALSO confirm `app.introspect()` returns the expected route table at boot,
// which the rest of the 8-hour track will lean on heavily.
//
// TODO:
// 1. Construct an `App` with `docs: true` and an `openapi.info` block.
// 2. Register GET /health that returns `{ status: "ok" }` typed with a Zod schema.
// 3. Print `app.introspect()` at boot so you see the operationId table.
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
			200: { description: "OK", body: z.object({ status: z.literal("ok") }) },
		},
	},
	async () => ({ status: 200 as const, body: { status: "ok" as const } }),
);

console.log("Registered routes:");
for (const op of app.introspect()) {
	console.log(`  ${op.method.padEnd(6)} ${op.path}  (operationId=${op.operationId})`);
}

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/health");
console.log("→ http://localhost:3000/docs");
