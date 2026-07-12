import { App, createJwtSigner, createJwtVerifier, UnauthorizedError, type Hooks } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const JWT_KEY = new TextEncoder().encode("do-not-use-this-in-production-this-is-a-workshop-secret");
const USERS = new Map([["alice", "wonderland"]]);
const signer = createJwtSigner({ alg: "HS256", key: JWT_KEY, maxLifetimeSeconds: 60 * 60 });
const verifier = createJwtVerifier({ algorithms: ["HS256"], key: JWT_KEY });

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: {
    info: { title: "Workshop API", version: "0.1.0" },
    securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
  },
  docs: true,
});

const jwtAuth: Hooks = {
  async beforeHandle(ctx) {
    const header = ctx.request.headers.get("authorization");
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing bearer token");
    }
    const token = header.slice("Bearer ".length);
    try {
      const verified = await verifier.verify(token);
      const sub = verified.payload.sub;
      if (typeof sub !== "string") throw new Error("missing sub");
      ctx.state.user = sub;
    } catch {
      throw new UnauthorizedError("Invalid token");
    }
  },
};

app.post(
  "/auth/login",
  {
    operationId: "login",
    tags: ["Auth"],
    request: {
      body: z.object({ username: z.string().min(1), password: z.string().min(1) }).strict(),
    },
    responses: {
      200: { description: "OK", body: z.object({ token: z.string() }) },
      401: { description: "Bad credentials" },
    },
  },
  async ({ body }) => {
    if (USERS.get(body.username) !== body.password) {
      throw new UnauthorizedError("Bad credentials");
    }
    const now = Math.floor(Date.now() / 1000);
    const token = await signer.sign({ sub: body.username, iat: now, exp: now + 60 * 60 });
    return { status: 200 as const, body: { token } };
  },
);

app.get(
  "/me",
  {
    operationId: "getMe",
    tags: ["Auth"],
    auth: { scheme: "bearer" },
    hooks: jwtAuth,
    responses: {
      200: { description: "OK", body: z.object({ sub: z.string() }) },
      401: { description: "Unauthorized" },
    },
  },
  async (ctx) => ({ status: 200 as const, body: { sub: String(ctx.state.user) } }),
);

// Bonus: JWKS-based asymmetric verification
//
// import { jwk } from "@daloyjs/core";
// app.use(jwk({
//   jwks: "https://your-idp.example.com/.well-known/jwks.json",
//   algorithms: ["RS256"],
//   fetchTtlSeconds: 600,
// }));

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
