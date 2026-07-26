// 8-HOUR · Exercise 6 — JWT with Algorithm Allowlist + JWK
//
// TODO:
// 1. Issue an HS256 JWT on POST /auth/login with createJwtSigner().
// 2. Verify it on GET /me with createJwtVerifier() + an EXPLICIT algorithm allowlist.
// 3. Try to verify a `{"alg":"none"}` token — should be rejected.
// 4. Bonus: swap to RS256/JWKS using `jwk(...)` (commented in solution).
//
// Docs: https://daloyjs.dev/docs/security/secure-defaults  ·  https://daloyjs.dev/docs/jwt

import {
  App,
  createJwtSigner,
  createJwtVerifier,
  UnauthorizedError,
  type Hooks,
} from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const JWT_KEY = new TextEncoder().encode("do-not-use-this-in-production-this-is-a-workshop-secret");
const USERS = new Map([["alice", "wonderland"]]);

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: {
    info: { title: "Workshop API", version: "0.1.0" },
    securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
  },
  docs: true,
});

// TODO: POST /auth/login → signer.sign({ sub, iat, exp })

// TODO: jwtAuth hook: parse Authorization, verifier.verify(token) with algorithms: ["HS256"] allowlist.

// TODO: GET /me protected by jwtAuth.

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
