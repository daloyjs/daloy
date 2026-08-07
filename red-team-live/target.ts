/**
 * RED-TEAM LIVE TARGET — a realistic @daloyjs/core service under attack.
 * =====================================================================
 *
 * This is NOT a unit test. It boots a real HTTP server on a real TCP port
 * (via the Node adapter's `serve()`), exactly as a developer would deploy it,
 * and then `run.ts` attacks it from a SEPARATE process over the wire — like a
 * bug-bounty hunter who only has the public URL.
 *
 * The app is written the way a competent developer would write it using the
 * framework's secure-by-default posture (production env, WAF, CORS allowlist,
 * rate-limited login, fetchGuard, safeRedirect, JWT-protected admin route,
 * response-body schemas, authenticated object/money routes with ownership
 * checks). We are attacking the FRAMEWORK'S defaults, not a
 * deliberately-broken app. Any weakness the harness reports is a weakness in
 * @daloyjs/core itself.
 *
 * Wave 5 hardened the APPLICATION-INTENT layer after a reasoning-level
 * engagement (see run.ts `wave5Probes`): /users/:id and /pay mounted no
 * authorization decision (BOLA / unauthenticated payment), and the login
 * rate limit keyed on a global constant (attacker-induced lockout of every
 * user). Those were trust-design flaws in this file, not in framework
 * primitives — fixed here, and the probes now assert the fixed behaviour so
 * the target cannot silently regress.
 *
 * Handshake: once listening, it prints `RED_TEAM_TARGET_READY <port>` so the
 * attacker process can discover the ephemeral port.
 */

import { z } from "zod";
import {
  App,
  waf,
  cors,
  rateLimit,
  fetchGuard,
  SsrfBlockedError,
  safeRedirect,
  OpenRedirectBlockedError,
  createJwtSigner,
  createJwtVerifier,
  multipartObject,
  fileField,
  csrf,
  requestDecompression,
  idempotency,
  MemoryIdempotencyStore,
  concurrencyLimit,
  basicAuth,
  botGuard,
  geoBlock,
  autoBan,
  clientCertAuth,
  except,
  every,
  bearerAuth,
  UnauthorizedError,
} from "../src/index.js";
import { serve } from "../src/adapters/node.js";

// Shared state for stateful middleware (created once so replays/strikes persist).
const idemStore = new MemoryIdempotencyStore();
let payCalls = 0;
// One autoBan instance shared across two routes so strikes accumulate per IP.
const ab = autoBan({
  trustProxyHeaders: true,
  windowMs: 60_000,
  maxStrikes: 3,
  banMs: 10_000,
  watchStatuses: [401, 403, 429],
  banStatus: 429,
});

// A server-side secret the attacker never possesses. 32 bytes (HS256 floor).
const JWT_SECRET = new TextEncoder().encode("live-target-jwt-secret-32-bytes!!");
const signer = createJwtSigner({ alg: "HS256", key: JWT_SECRET, maxLifetimeSeconds: 3600 });
const verifier = createJwtVerifier({
  algorithms: ["HS256"],
  key: JWT_SECRET,
  maxLifetimeSeconds: 3600,
});

const problem = (status: number, title: string, detail?: string) =>
  new Response(
    JSON.stringify({ type: "about:blank", title, status, ...(detail ? { detail } : {}) }),
    {
      status,
      headers: { "content-type": "application/problem+json", "cache-control": "no-store" },
    }
  );

/** Route guard: verify a Bearer JWT and require the `admin` scope. */
function requireAdmin() {
  return {
    async beforeHandle(ctx: any) {
      const m = /^Bearer\s+(.+)$/i.exec(ctx.request.headers.get("authorization") ?? "");
      if (!m) return problem(401, "Unauthorized");
      let claims: any;
      try {
        claims = await verifier.verify(m[1]!);
      } catch {
        return problem(403, "Forbidden", "invalid token");
      }
      const scopes = Array.isArray(claims.payload.scopes) ? claims.payload.scopes : [];
      if (!scopes.includes("admin")) return problem(403, "Forbidden", "insufficient scope");
      ctx.state.user = claims.payload;
      return undefined;
    },
  };
}

/**
 * Route guard: verify a Bearer JWT and accept ANY authenticated identity.
 *
 * Added for the wave-5 reasoning-layer findings: object and money routes
 * that mounted no authorization decision at all (BOLA / unauthenticated
 * payment). Claim shapes are type-checked before anything reads them, so a
 * `scopes: "admin"` string can never impersonate an array claim.
 */
function requireAuth() {
  return {
    async beforeHandle(ctx: any) {
      const m = /^Bearer\s+(.+)$/i.exec(ctx.request.headers.get("authorization") ?? "");
      if (!m) return problem(401, "Unauthorized");
      try {
        const claims = await verifier.verify(m[1]!);
        ctx.state.user = claims.payload;
      } catch {
        return problem(403, "Forbidden", "invalid token");
      }
      return undefined;
    },
  };
}

const app = new App({
  env: "production",
  logger: false,
  // A long-running attack harness must not be killed by the prod crash-on-
  // unhandled-rejection guard the moment a probe trips an edge case; the
  // attacker process detects a real crash via connection-refused instead.
  crashOnUnhandledRejection: false,
  // Small per-file cap so an oversized-upload attack is easy to demonstrate.
  multipart: { maxFileBytes: 64 },
  // The geo/ban middleware key on the client IP from X-Forwarded-For. The
  // framework REFUSES to trust that spoofable header in production unless you
  // declare you're behind a trusted proxy (a secure default) — a real
  // deployment using these features runs behind a load balancer, so opt in.
  trustProxy: true,
});

// Signature WAF + a strict cross-origin allowlist — standard hardening.
app.use(waf());
app.use(cors({ origin: "https://app.example.com", credentials: true }));
// Access-control feeds that only act on their specific inputs (a blocked UA or
// a denied country via X-Forwarded-For), so they don't disturb normal traffic.
app.use(botGuard({ blockedUserAgents: [/evil-scraper/i] }));
app.use(
  geoBlock({
    deny: ["ZZ"],
    trustProxyHeaders: true,
    lookupCountry: (ip) => ({ "203.0.113.7": "ZZ" })[ip],
  })
);

// ---- public ----
app.route({
  method: "GET",
  path: "/healthz",
  operationId: "health",
  responses: { 200: { description: "ok", body: z.object({ status: z.string() }) as any } },
  handler: async () => ({ status: 200 as const, body: { status: "ok" } }),
});

// ---- login (rate-limited credential check that mints a user-scoped JWT) ----
app.route({
  method: "POST",
  path: "/login",
  operationId: "login",
  // Wave-5 fix: the bucket must never be a global constant — one attacker
  // burning a shared bucket locked EVERY user out (availability finding).
  // trustedHops: 1 keys on the rightmost X-Forwarded-For entry (the hop your
  // LB appends), so rotating spoofed left entries cannot evade the throttle.
  hooks: rateLimit({ windowMs: 60_000, max: 5, trustedHops: 1 }),
  request: { body: z.object({ user: z.string(), pass: z.string() }).strict() as any },
  responses: {
    200: { description: "ok", body: z.object({ token: z.string() }) as any },
    401: { description: "bad creds", body: z.object({ error: z.string() }) as any },
  },
  handler: async ({ body }: any) => {
    // Two tenants so black-box probes can prove cross-tenant isolation.
    const creds: Record<string, string> = {
      alice: "correct-horse-battery",
      bob: "bob-hunter2-passphrase",
    };
    if (creds[body.user] === body.pass) {
      const token = await signer.sign({
        sub: body.user,
        scopes: ["user"], // NEVER admin — privilege escalation must be forged
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      return { status: 200 as const, body: { token } };
    }
    return { status: 401 as const, body: { error: "invalid credentials" } };
  },
});

// ---- protected admin resource ----
app.route({
  method: "GET",
  path: "/admin",
  operationId: "admin",
  hooks: requireAdmin(),
  responses: { 200: { description: "ok", body: z.object({ secret: z.string() }) as any } },
  handler: async () => ({ status: 200 as const, body: { secret: "TOP-SECRET-FLAG-7f3a9" } }),
});

// ---- user record (response schema must strip the leaked passwordHash) ----
app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  // Wave-5 fix: BOLA. This route mounted NO authorization decision — any
  // anonymous caller could enumerate any user's PII by walking the id space.
  // Now: a verified token is required, and the caller may only read their own
  // record (admins excepted). The response-body schema still strips the
  // carelessly-returned passwordHash (OWASP API3 defense-in-depth).
  hooks: requireAuth(),
  request: { params: z.object({ id: z.string() }) as any },
  responses: {
    200: {
      description: "ok",
      body: z.object({ id: z.string(), name: z.string(), email: z.string() }) as any,
    },
    403: {
      description: "forbidden — not your record",
      // Declared problem+json body so the refusal stays INSIDE the response
      // contract (a raw Response return would be refused closed by design).
      body: z.object({
        type: z.string(),
        title: z.string(),
        status: z.number(),
        detail: z.string().optional(),
      }) as any,
    },
  },
  handler: async ({ params, state }: any) => {
    const caller = state.user as { sub?: string; scopes?: unknown };
    const scopes = Array.isArray(caller.scopes) ? caller.scopes : [];
    if (caller.sub !== params.id && !scopes.includes("admin")) {
      return {
        status: 403 as const,
        body: {
          type: "about:blank",
          title: "Forbidden",
          status: 403,
          detail: "you may only read your own record",
        },
      };
    }
    return {
      status: 200 as const,
      // The handler carelessly returns a sensitive field; the response-body
      // schema is a FILTER, so it must never reach the client (OWASP API3).
      body: {
        id: params.id,
        name: "User " + params.id,
        email: `u${params.id}@x.test`,
        passwordHash: "$2b$10$LEAKED",
      } as any,
    };
  },
});

// ---- create item (strict schema → mass-assignment / proto-pollution target) ----
app.route({
  method: "POST",
  path: "/items",
  operationId: "createItem",
  request: { body: z.object({ name: z.string(), price: z.number() }).strict() as any },
  responses: {
    201: { description: "created", body: z.object({ name: z.string(), price: z.number() }) as any },
  },
  handler: async ({ body }: any) => ({
    status: 201 as const,
    body: { name: body.name, price: body.price },
  }),
});

// ---- search (WAF + typed query → injection target) ----
app.route({
  method: "GET",
  path: "/search",
  operationId: "search",
  request: { query: z.object({ q: z.string() }) as any },
  responses: { 200: { description: "ok", body: z.object({ q: z.string() }) as any } },
  handler: async ({ query }: any) => ({ status: 200 as const, body: { q: query.q } }),
});

// ---- server-side fetch behind fetchGuard (SSRF target) ----
app.route({
  method: "GET",
  path: "/fetch",
  operationId: "fetchUrl",
  acknowledgeNoResponseBodySchema: true,
  request: { query: z.object({ url: z.string() }) as any },
  // The handler can return 403 (SSRF blocked) / 502 (upstream failure); they
  // MUST be declared or the framework's response-contract guard turns an
  // undeclared status into a 500 (OWASP API9 inventory discipline).
  responses: {
    200: { description: "ok", body: z.object({ fetched: z.boolean() }) as any },
    403: { description: "ssrf blocked" },
    502: { description: "upstream failed" },
  },
  handler: async ({ query }: any) => {
    const guarded = fetchGuard();
    try {
      await guarded(query.url);
      return { status: 200 as const, body: { fetched: true } };
    } catch (e) {
      if (e instanceof SsrfBlockedError) return problem(403, "Forbidden", "SSRF blocked");
      return problem(502, "Bad Gateway", "fetch failed");
    }
  },
});

// ---- redirect behind safeRedirect (open-redirect target) ----
app.route({
  method: "GET",
  path: "/go",
  operationId: "go",
  acknowledgeNoResponseBodySchema: true,
  request: { query: z.object({ to: z.string() }) as any },
  responses: { 303: { description: "redirect" }, 400: { description: "open redirect blocked" } },
  handler: async ({ query }: any) => {
    try {
      return safeRedirect(query.to, {
        allowedPaths: ["/*"],
        allowedOrigins: ["https://app.example.com"],
      });
    } catch (e) {
      if (e instanceof OpenRedirectBlockedError)
        return problem(400, "Bad Request", "open redirect blocked");
      throw e;
    }
  },
});

// ---- a route that reflects user input into a RESPONSE header (CRLF target) ----
app.route({
  method: "GET",
  path: "/echo-header",
  operationId: "echoHeader",
  request: { query: z.object({ v: z.string() }) as any },
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async ({ query, set }: any) => {
    // A naive developer reflects a query value into a response header. The
    // framework / runtime must refuse a CRLF-bearing value (response splitting).
    set.headers.set("x-echo", query.v);
    return { status: 200 as const, body: { ok: true } };
  },
});

// ---- CSRF double-submit (state-changing POST) ----
app.route({
  method: "POST",
  path: "/csrf-act",
  operationId: "csrfAct",
  hooks: csrf({
    cookieName: "csrf",
    headerName: "x-csrf-token",
    generator: () => "tok",
    cookieOptions: { secure: false },
  }),
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
});

// ---- decompression bomb target ----
app.route({
  method: "POST",
  path: "/ingest",
  operationId: "ingest",
  hooks: requestDecompression({ maxDecompressedBytes: 1024, maxRatio: 50 }),
  request: { body: z.object({ value: z.string() }) as any },
  responses: { 200: { description: "ok", body: z.object({ len: z.number() }) as any } },
  handler: async ({ body }: any) => ({ status: 200 as const, body: { len: body.value.length } }),
});

// ---- idempotency (replay + cross-tenant) target ----
app.route({
  method: "POST",
  path: "/pay",
  operationId: "pay",
  // Wave-5 fix: a money route mounted no auth and took the "owner" identity
  // from the raw Authorization STRING — any anonymous caller could move money
  // as "Bearer CEO-OF-THE-COMPANY". Auth now runs first, and the owner comes
  // exclusively from verified JWT claims. Idempotency then scopes stored
  // responses per verified identity, so a guessed key never discloses another
  // tenant's receipt.
  hooks: every(requireAuth(), idempotency({ store: idemStore })),
  // Money must be sign/range-constrained at the schema boundary: reject
  // negative, zero, sub-cent dust (ledger-rounding fraud class), and
  // out-of-domain amounts before the handler ever runs. Zod v4 already
  // rejects NaN/Infinity by default, and amounts are decimal (not integer),
  // so `.finite()`/`.safe()` are deliberately omitted here — both are no-ops
  // or wrong for money in v4 (`.safe()` now means `.int()`).
  request: { body: z.object({ amount: z.number().min(0.01).max(1_000_000) }) as any },
  responses: {
    201: { description: "ok", body: z.object({ owner: z.string(), call: z.number() }) as any },
  },
  handler: async ({ state }: any) => ({
    status: 201 as const,
    body: { owner: (state.user as { sub: string }).sub, call: ++payCalls },
  }),
});

// ---- concurrency limit (load shedding) target ----
app.route({
  method: "GET",
  path: "/slow",
  operationId: "slow",
  hooks: concurrencyLimit({ maxConcurrent: 1, maxQueue: 0, retryAfterSeconds: 2 }),
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => {
    await new Promise((r) => setTimeout(r, 250));
    return { status: 200 as const, body: { ok: true } };
  },
});

// ---- basic-auth (account-enumeration target) ----
app.route({
  method: "GET",
  path: "/basic-vault",
  operationId: "basicVault",
  hooks: basicAuth({
    realm: "api",
    verify: (u, p) => (u === "alice" && p === "s3cret-correct" ? { username: u } : false),
  }),
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
});

// ---- destructive DELETE (method-override smuggling target) ----
app.route({
  method: "DELETE",
  path: "/resource",
  operationId: "destroy",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
});

// ---- JSON parsing DoS targets (stack bomb + hash flood) ----
app.route({
  method: "POST",
  path: "/sink",
  operationId: "sink",
  request: { body: z.object({ data: z.any() }) as any },
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
});
app.route({
  method: "POST",
  path: "/wide",
  operationId: "wide",
  request: { body: z.record(z.string(), z.string()) as any },
  responses: { 200: { description: "ok", body: z.object({ n: z.number() }) as any } },
  handler: async ({ body }: any) => ({
    status: 200 as const,
    body: { n: Object.keys(body).length },
  }),
});

// ---- mTLS (spoofed client-cert header target) ----
app.route({
  method: "GET",
  path: "/mtls",
  operationId: "mtls",
  hooks: clientCertAuth(),
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
});

// ---- autoBan (fail2ban-style strike banning) targets ----
app.route({
  method: "GET",
  path: "/ab-login",
  operationId: "abLogin",
  hooks: ab,
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => {
    throw new UnauthorizedError("bad credentials");
  },
});
app.route({
  method: "GET",
  path: "/ab-public",
  operationId: "abPublic",
  hooks: ab,
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
});

// ---- multipart upload (magic-byte + size validation → upload-abuse target) ----
app.route({
  method: "POST",
  path: "/upload",
  operationId: "upload",
  request: {
    body: multipartObject({
      avatar: fileField({ accept: ["image/png"], magicBytes: true }),
    }) as any,
  },
  responses: { 201: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => ({ status: 201 as const, body: { ok: true } }),
});

// ---- WebSocket channel with a same-origin policy (CSWSH target) ----
app.ws("/ws", {
  acknowledgeUnauthenticated: true,
  // The global cors() matches this path; it does not run on the Upgrade
  // handshake, so acknowledge the header-mutating-middleware guard.
  acknowledgeHeaderMutatingMiddleware: true,
  allowedOrigins: "same-origin",
  message(conn: any, data: unknown) {
    conn.send(data as string);
  },
});

// ---------------------------------------------------------------------------
// A SECOND app dedicated to global except()-based auth, so its blanket guard
// can be probed for path-confusion bypasses without gating the main app.
// ---------------------------------------------------------------------------
const appB = new App({ env: "development", logger: false });
appB.use(except(["/public/**"], bearerAuth({ validate: (t) => t === "good" })));
appB.route({
  method: "GET",
  path: "/api/admin",
  operationId: "bAdmin",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
});
appB.route({
  method: "GET",
  path: "/public/info",
  operationId: "bPublic",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
});

// ---------------------------------------------------------------------------
// A THIRD app: autoBan behind `trustedProxies` — peer-verified forwarded
// trust. The declared proxy range (10.0.0.0/8) deliberately does NOT include
// the loopback peer every harness request arrives from, so this app models
// "origin reachable directly": spoofed XFF must be IGNORED, strikes must
// land on the unspoofable real peer, and neither victim-IP framing nor
// rotation evasion can work. Two independent instances (separate groupIds)
// keep the framing and evasion probes from sharing a store.
// ---------------------------------------------------------------------------
const appC = new App({ env: "development", logger: false });
const banOpts = {
  trustedProxies: ["10.0.0.0/8"],
  windowMs: 60_000,
  maxStrikes: 3,
  banMs: 30_000,
  watchStatuses: [401],
  banStatus: 429 as const,
};
// Per-route mounting (never app-wide) so the framing and evasion instances
// share no store and never gate each other's routes.
const framingBan = autoBan({ ...banOpts, groupId: "c-framing" });
appC.route({
  method: "GET",
  path: "/c-login",
  operationId: "cLogin",
  hooks: framingBan,
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => {
    throw new UnauthorizedError("bad credentials");
  },
});
appC.route({
  method: "GET",
  path: "/c-public",
  operationId: "cPublic",
  hooks: framingBan,
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
});
const evasionBan = autoBan({ ...banOpts, groupId: "c-evasion" });
appC.route({
  method: "GET",
  path: "/c-ev-login",
  operationId: "cEvLogin",
  hooks: evasionBan,
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
  handler: async () => {
    throw new UnauthorizedError("bad credentials");
  },
});

const handle = serve(app, {
  port: Number(process.env.PORT) || 0,
  hostname: "127.0.0.1",
  // Short header/request timeout so a slowloris is cut quickly enough to demo.
  connectionTimeoutMs: 2000,
});
const handleB = serve(appB, { port: 0, hostname: "127.0.0.1", connectionTimeoutMs: 2000 });
const handleC = serve(appC, { port: 0, hostname: "127.0.0.1", connectionTimeoutMs: 2000 });

const portOf = (s: typeof handle.server) => {
  const addr = s.address();
  return typeof addr === "object" && addr ? addr.port : 0;
};
let readyA = handle.server.listening;
let readyB = handleB.server.listening;
let readyC = handleC.server.listening;
const announce = () => {
  if (readyA && readyB && readyC) {
    process.stdout.write(
      `RED_TEAM_TARGET_READY ${portOf(handle.server)} ${portOf(handleB.server)} ${portOf(handleC.server)}\n`
    );
  }
};
if (readyA) announce();
else handle.server.once("listening", () => ((readyA = true), announce()));
if (readyB) announce();
else handleB.server.once("listening", () => ((readyB = true), announce()));
if (readyC) announce();
else handleC.server.once("listening", () => ((readyC = true), announce()));
