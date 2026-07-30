/**
 * Type-level regression tests for {@link IdentityGateContext}, the context handed
 * to the caller-supplied resolvers of the network-identity access-control gates.
 *
 * Validated at compile time by `pnpm typecheck` (which runs `tsc` against
 * `tsconfig.typetest.json`).
 *
 * Background: those gates were moved from `beforeHandle` to `preBody` so a
 * `responseCache()` hit could not preempt them. Their option callbacks kept being
 * typed on the full `BaseContext`, whose `body` widens to `any` — so
 * `(ctx) => ctx.body.email` still type-checked while evaluating to `undefined` at
 * run time. Two of the five gates failed *silently* on an unresolved identity:
 * `ipReputation` fails open, and `autoBan` never recorded a strike because it had
 * nothing to attribute one to. A misconfiguration that disables a security
 * control with no error is exactly what a type should catch, hence these
 * assertions.
 */

import { autoBan, botGuard, geoBlock, ipReputation, ipRestriction } from "../../src/index.js";

// ---------------------------------------------------------------------------
// The body is statically unavailable — a `preBody` gate has parsed nothing.
// ---------------------------------------------------------------------------

geoBlock({
  deny: ["ZZ"],
  lookupCountry: () => "US",
  // @ts-expect-error `body` is always `undefined` in `preBody`; reading through
  // it used to compile via `BaseContext`'s `any` and silently resolve nothing.
  resolveIp: (ctx) => ctx.body.clientIp,
});

ipRestriction({
  deny: ["10.0.0.0/8"],
  // @ts-expect-error see above — fails closed (403 on everything) at run time.
  resolveIp: (ctx) => ctx.body.clientIp,
});

botGuard({
  // @ts-expect-error see above.
  resolveIp: (ctx) => ctx.body.clientIp,
});

ipReputation({
  feeds: [{ name: "f", fetch: async () => [] }],
  // @ts-expect-error see above — this one fails *open*, the worst outcome.
  resolveIp: (ctx) => ctx.body.clientIp,
});

autoBan({
  // @ts-expect-error see above — this one silently stops banning entirely.
  keyGenerator: (ctx) => ctx.body.email,
});

geoBlock({
  deny: ["ZZ"],
  // @ts-expect-error `resolveCountry` runs in the same phase.
  resolveCountry: (ctx) => ctx.body.country,
});

// ---------------------------------------------------------------------------
// Everything a `preBody` resolver may legitimately read still type-checks.
// ---------------------------------------------------------------------------

geoBlock({
  deny: ["ZZ"],
  lookupCountry: () => "US",
  resolveIp: (ctx) => ctx.request.headers.get("cf-connecting-ip") ?? undefined,
});

geoBlock({
  deny: ["ZZ"],
  resolveCountry: (ctx) => ctx.request.headers.get("cf-ipcountry"),
});

ipRestriction({
  deny: ["10.0.0.0/8"],
  resolveIp: (ctx) => (ctx.state as Record<string, string | undefined>).edgeIp,
});

botGuard({
  resolveIp: (ctx) => ctx.headers["x-real-ip"],
});

ipReputation({
  feeds: [{ name: "f", fetch: async () => [] }],
  resolveIp: (ctx) => ctx.query["ip"] as string | undefined,
});

autoBan({
  // A header-derived key resolves fine in `preBody`, so the ban stays immune to
  // a cache hit mounted above it.
  keyGenerator: (ctx) => ctx.request.headers.get("x-api-key") ?? undefined,
});
