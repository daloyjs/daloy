/**
 * Internal-service example.
 *
 * Demonstrates the `preset: "internal-service"` security posture for
 * service-to-service deployments behind a service mesh, sidecar, or
 * private network (Istio / Linkerd / Consul / k8s NetworkPolicies / VPN).
 *
 * The preset turns OFF only the topology-dependent guards that exist for
 * browser-facing APIs:
 *
 *   - `secureHeaders` auto-install        (no browser to read HSTS / CSP)
 *   - `corsCrossOriginGuard`              (no browser Origin header to guard)
 *   - `csrf` boot guard                   (service callers aren't browsers)
 *   - unconfigured `X-Forwarded-*` guard  (the mesh terminates TLS)
 *
 * Everything that protects the *service itself* stays on:
 *
 *   - `bodyLimitBytes` / `requestTimeoutMs`
 *   - JWT algorithm allowlist + `timingSafeEqual` credential checks
 *   - Prototype-pollution-safe parsers + `isForbiddenObjectKey`
 *   - `fetchGuard()` SSRF defaults
 *   - Weak session secret refuse-to-boot
 *   - `cors({ origin: '*' })` refuse-to-boot
 *   - Anonymous stateful plugin refuse-to-boot
 *   - `crashOnUnhandledRejection` (in production)
 *   - RFC 9457 problem+json with prod-mode redaction
 *   - Schema `.strict()` + response validation when enabled
 *
 * Run:
 *   pnpm exec tsx examples/internal-service.ts
 *
 * Then:
 *   curl http://localhost:3001/users/42
 *   curl http://localhost:3001/__security    # live posture snapshot
 *
 * Audit the posture in code:
 *   const posture = app.getSecurityPosture();
 *   //   { preset: "internal-service",
 *   //     secureHeaders: false,
 *   //     corsCrossOriginGuard: false,
 *   //     csrf: "off",
 *   //     trustProxy: false,
 *   //     bodyLimitBytes: 1048576,
 *   //     requestTimeoutMs: 30000, ... }
 */

import { z } from "zod";
import { App } from "../src/index.ts";
import { serve } from "../src/adapters/node.ts";

const app = new App({
  // Single line: switch the posture for an internal service.
  preset: "internal-service",
  production: process.env.NODE_ENV === "production",
  bodyLimitBytes: 256 * 1024, // tighter limit for an internal RPC-style service
  requestTimeoutMs: 5_000,
});

// --- Business routes ---------------------------------------------------------

const User = z.object({ id: z.string(), name: z.string() });

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  tags: ["Users"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "OK", body: User },
  },
  handler: async ({ params }) => ({
    status: 200 as const,
    body: { id: params.id, name: `User ${params.id}` },
  }),
});

// --- Operator-facing posture introspection -----------------------------------
//
// Exposes the live security posture so SREs, mesh operators, and CI audits
// can see exactly which guards are on without reading the framework source.

app.route({
  method: "GET",
  path: "/__security",
  operationId: "securityPosture",
  tags: ["Ops"],
  responses: {
    200: {
      description: "Live security posture snapshot",
      body: z.object({
        preset: z.string().nullable(),
        secureDefaults: z.boolean(),
        secureHeaders: z.boolean(),
        corsCrossOriginGuard: z.boolean(),
        csrf: z.enum(["on", "off"]),
        trustProxy: z.union([z.boolean(), z.literal("unconfigured")]),
        bodyLimitBytes: z.number(),
        requestTimeoutMs: z.number(),
        production: z.boolean(),
      }),
    },
  },
  handler: async () => {
    const p = app.getSecurityPosture();
    return {
      status: 200 as const,
      body: {
        preset: p.preset ?? null,
        secureDefaults: p.secureDefaults,
        secureHeaders: p.secureHeaders,
        corsCrossOriginGuard: p.corsCrossOriginGuard,
        csrf: p.csrf,
        trustProxy: p.trustProxy,
        bodyLimitBytes: p.bodyLimitBytes,
        requestTimeoutMs: p.requestTimeoutMs,
        production: p.production,
      },
    };
  },
});

const port = Number(process.env.PORT ?? 3001);
serve(app, { port });
// eslint-disable-next-line no-console
console.log(`internal-service example listening on http://localhost:${port}`);
