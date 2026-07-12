/**
 * Multitenancy demo — DaloyJS `tenancy()` + per-tenant isolation.
 *
 * Shows the secure-by-default multi-tenant pattern end to end:
 *   - Resolve the tenant from the request subdomain (acme.example.com → "acme").
 *   - Bound the tenant space with an allowlist (unknown tenant → 404, no enum).
 *   - Give every tenant its own rate-limit bucket via tenantScope().
 *   - Isolate per-tenant data: handlers key storage off ctx.state.tenant, never
 *     a value from the request body, so one tenant can never read or write
 *     another's rows.
 *
 * Run it:
 *
 *   node --import tsx examples/multitenancy-demo.ts
 *
 * The Node adapter builds the request URL from the Host header, so you can
 * exercise subdomains locally without DNS by setting Host explicitly:
 *
 *   # acme's data is separate from globex's:
 *   curl -s localhost:3003/orders -H 'Host: acme.example.com'
 *   curl -s -X POST localhost:3003/orders -H 'Host: acme.example.com' \
 *     -H 'content-type: application/json' -d '{"item":"widget","total":9.99}'
 *   curl -s localhost:3003/orders -H 'Host: acme.example.com'    # shows acme's order
 *   curl -s localhost:3003/orders -H 'Host: globex.example.com'  # still empty
 *
 *   # Unknown tenant → 404 (indistinguishable from a missing route):
 *   curl -s -o /dev/null -w '%{http_code}\n' localhost:3003/orders -H 'Host: intruder.example.com'
 *
 *   # No subdomain → 400 (cannot determine tenant):
 *   curl -s -o /dev/null -w '%{http_code}\n' localhost:3003/orders -H 'Host: example.com'
 *
 *   # Per-tenant rate limit (max 5/min): the 6th acme request is 429, but
 *   # globex is unaffected.
 */

import { serve } from "../src/adapters/node.ts";
import { App, rateLimit, tenancy, tenantFromSubdomain, tenantScope } from "../src/index.ts";
import { z } from "zod";

// Augment AppState so ctx.state.tenant is typed in handlers.
declare module "../src/index.js" {
  interface AppState {
    tenant?: string;
  }
}

interface Order {
  id: string;
  item: string;
  total: number;
}

// In-memory store, partitioned by tenant id. The ONLY key is the resolved
// ctx.state.tenant — never a tenant value taken from the request body.
const ordersByTenant = new Map<string, Order[]>();
function ordersFor(tenant: string): Order[] {
  let rows = ordersByTenant.get(tenant);
  if (!rows) ordersByTenant.set(tenant, (rows = []));
  return rows;
}

const app = new App({
  env: "development",
  // tenancy() is a global hook so it resolves BEFORE the group-level rateLimit
  // below, guaranteeing ctx.state.tenant is set when tenantScope() runs.
  hooks: tenancy({
    resolve: tenantFromSubdomain({ baseDomain: "example.com" }),
    allow: ["acme", "globex", "umbrella"],
  }),
});

// Per-tenant rate limiting: each tenant gets its own 5-requests/minute bucket.
app.use(rateLimit({ windowMs: 60_000, max: 5, keyGenerator: tenantScope() }));

app.get(
  "/orders",
  {
    operationId: "listOrders",
    summary: "List the calling tenant's orders",
    responses: {
      200: {
        description: "Order list (scoped to the resolved tenant)",
        body: z.object({
          tenant: z.string(),
          orders: z.array(z.object({ id: z.string(), item: z.string(), total: z.number() })),
        }),
      },
    },
  },
  ({ state }) => {
    const tenant = state.tenant!; // guaranteed by tenancy({ require: true })
    return { status: 200 as const, body: { tenant, orders: ordersFor(tenant) } };
  },
);

app.post(
  "/orders",
  {
    operationId: "createOrder",
    summary: "Create an order for the calling tenant",
    request: { body: z.object({ item: z.string(), total: z.number().positive() }) },
    responses: {
      201: {
        description: "Order created",
        body: z.object({ id: z.string(), item: z.string(), total: z.number() }),
      },
    },
  },
  ({ body, state }) => {
    const tenant = state.tenant!;
    const order: Order = { id: `ord-${ordersFor(tenant).length + 1}`, item: body.item, total: body.total };
    ordersFor(tenant).push(order);
    return { status: 201 as const, body: order };
  },
);

const PORT = 3003;
const { port } = serve(app, { port: PORT });
console.log(`DaloyJS multitenancy demo running at http://localhost:${port}`);
console.log(`Resolve tenant from subdomain under example.com (allow: acme, globex, umbrella).`);
console.log(`Try:  curl -s localhost:${port}/orders -H 'Host: acme.example.com'`);
