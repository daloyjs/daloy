// 8-HOUR · Exercise 5 — Bearer Auth + per-Route Auth
//
// TODO:
// 1. Declare TWO security schemes: bearer (for /admin) and apiKey (for /partner).
// 2. Require bearer on POST /admin/books, require apiKey on GET /partner/books.
// 3. Use timingSafeEqual to compare the bearer token. Use a simple lookup map
//    for the api key. Return 401 (missing) vs 403 (wrong).
//
// Docs: https://daloyjs.dev/docs/security  ·  https://daloyjs.dev/docs/openapi

import { App, bearerAuth, UnauthorizedError, ForbiddenError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const VALID_ADMIN_TOKEN = "admin-token";
const VALID_API_KEYS = new Map([
  ["partner-a", "team-blue"],
  ["partner-b", "team-red"],
]);

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: {
    info: { title: "Workshop API", version: "0.1.0" },
    // TODO: securitySchemes for bearer + apiKey
  },
  docs: true,
});

const BookSchema = z.object({ id: z.string(), title: z.string() });
const books = new Map<string, { id: string; title: string }>();

// TODO: POST /admin/books — bearer auth via bearerAuth({ validate }).

// TODO: GET /partner/books — apiKey auth via custom middleware reading
//       the X-API-Key header.

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");

export { VALID_ADMIN_TOKEN, timingSafeEqual };
