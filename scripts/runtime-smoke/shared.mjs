/**
 * Cross-runtime smoke suite shared by the Deno, Bun, and workerd runners.
 *
 * Plain ESM with no dependencies so every runtime can load it as-is. Each
 * runner builds the same app from the compiled `dist/` output (the bytes we
 * publish), puts it behind that runtime's real adapter, and runs
 * {@link runChecks} against it over HTTP. The unit suite stubs `Bun`/`Deno`
 * globals; this suite is what proves the adapters work on the real runtimes.
 */

/** Smallest Standard Schema v1 validator: `{ hello: string }`, nothing else. */
const helloSchema = {
  "~standard": {
    version: 1,
    vendor: "daloy-smoke",
    validate(value) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 1 &&
        typeof value.hello === "string"
      ) {
        return { value };
      }
      return { issues: [{ message: "expected { hello: string }" }] };
    },
  },
};

/**
 * Build the smoke app from the compiled `dist/index.js` module namespace.
 *
 * @param {typeof import("../../src/index.js")} core - The imported `dist/index.js` namespace.
 * @returns {import("../../src/app.js").App} An app with a fixed set of probe routes.
 */
export function buildSmokeApp(core) {
  const { App, getConnInfo } = core;
  // Clients hit the server directly, so forwarded headers must be ignored.
  const app = new App({
    logger: false,
    env: "production",
    bodyLimitBytes: 64,
    behindProxy: "none",
  });
  app.route({
    method: "GET",
    path: "/health",
    operationId: "smokeHealth",
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: async () => ({ status: 200, body: { ok: true } }),
  });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "smokeEcho",
    request: { body: helloSchema },
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: async (ctx) => ({ status: 200, body: { hello: ctx.body.hello } }),
  });
  app.route({
    method: "GET",
    path: "/peer",
    operationId: "smokePeer",
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: async (ctx) => ({
      status: 200,
      body: { peer: getConnInfo(ctx.request)?.remoteAddress ?? null },
    }),
  });
  app.route({
    method: "GET",
    path: "/cookies",
    operationId: "smokeCookies",
    responses: { 204: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: async () => {
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "a=1; Path=/; HttpOnly; Secure; SameSite=Lax",
      );
      headers.append(
        "set-cookie",
        "b=2; Path=/; HttpOnly; Secure; SameSite=Lax",
      );
      return new Response(null, { status: 204, headers });
    },
  });
  return app;
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Run every probe against a live server and throw on the first failure.
 *
 * @param {string} baseUrl - Origin of the running server, e.g. `http://127.0.0.1:8787`.
 * @param {{ peer: "socket" | "none" }} expect - Whether the adapter reports a TCP peer.
 * @returns {Promise<string[]>} The names of the checks that passed.
 */
export async function runChecks(baseUrl, expect) {
  const passed = [];

  const health = await fetch(`${baseUrl}/health`);
  check(health.status === 200, `GET /health -> ${health.status}`);
  check((await health.json()).ok === true, "GET /health body");
  check(
    health.headers.get("x-content-type-options") === "nosniff",
    "secure headers missing on /health",
  );
  passed.push("routing + secure headers");

  const echo = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hello: "runtime" }),
  });
  check(echo.status === 200, `POST /echo -> ${echo.status}`);
  check((await echo.json()).hello === "runtime", "POST /echo body");
  passed.push("JSON body + schema");

  const invalid = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hello: 1 }),
  });
  check(invalid.status === 422, `invalid body -> ${invalid.status}, want 422`);
  await invalid.body?.cancel();
  passed.push("schema rejection");

  const big = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hello: "x".repeat(256) }),
  });
  check(big.status === 413, `oversized body -> ${big.status}, want 413`);
  await big.body?.cancel();
  passed.push("bodyLimitBytes");

  const missing = await fetch(`${baseUrl}/nope`);
  check(missing.status === 404, `GET /nope -> ${missing.status}`);
  check(
    (missing.headers.get("content-type") ?? "").startsWith(
      "application/problem+json",
    ),
    "404 is not problem+json",
  );
  await missing.body?.cancel();
  passed.push("problem+json 404");

  const cookies = await fetch(`${baseUrl}/cookies`);
  const setCookies = cookies.headers.getSetCookie();
  check(cookies.status === 204, `GET /cookies -> ${cookies.status}`);
  check(setCookies.length === 2, `want 2 Set-Cookie, got ${setCookies.length}`);
  passed.push("multiple Set-Cookie");

  const peer = await fetch(`${baseUrl}/peer`, {
    headers: { "x-forwarded-for": "203.0.113.66" },
  });
  const peerBody = await peer.json();
  check(
    peerBody.peer !== "203.0.113.66",
    "peer address was taken from a spoofable header",
  );
  if (expect.peer === "socket") {
    check(
      typeof peerBody.peer === "string" && peerBody.peer.length > 0,
      "socket peer missing",
    );
  } else {
    check(peerBody.peer === null, `unexpected peer ${String(peerBody.peer)}`);
  }
  passed.push(
    expect.peer === "socket"
      ? "conn-info from socket, not headers"
      : "conn-info never from headers",
  );

  return passed;
}
