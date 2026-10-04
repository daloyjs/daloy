// Local development server.
//
// Vercel runs `api/index.ts` as a Function in production; this serves the very
// same app over a plain Node listener so you get fast local iteration without
// `vercel dev` (no Vercel login, no edge emulation). Routes are served at the
// root here (`/healthz`, `/docs`, …), exactly as on the deployed site — in
// production the `vercel.json` rewrite maps every path to the Function.
//
// Run with: `pnpm dev` (or `npm run dev`).
import { serve } from "@daloyjs/core/node";
import { app } from "../api/index.ts";

// 5xx error detail is shown only on a positive development signal; an unset
// NODE_ENV redacts it, so default it here for the local server only.
process.env.NODE_ENV ||= "development";

const port = Number(process.env.PORT ?? 3000);
serve(app, { port });
// eslint-disable-next-line no-console
console.log(`DaloyJS dev server listening on http://localhost:${port}`);
