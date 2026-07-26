/**
 * Cross-Site WebSocket Hijacking (CSWSH) guard.
 *
 * Exercises `app.ws()`'s production refuse-at-registration check and the
 * runtime Origin allowlist that closes the Storybook CVE-2026-27148 class
 * of bug: a malicious site triggering `new WebSocket(...)` in a victim's
 * browser, which auto-attaches cookies on the upgrade. Without an Origin
 * allowlist the upgrade succeeds and the attacker speaks the protocol on
 * the user's behalf.
 *
 * @since 0.33.0
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App } from "../src/app.js";
import { checkWebSocketOrigin } from "../src/websocket.js";

// ---------- Registration guard ----------

test("CSWSH: production app.ws() refuses route without Origin policy or acknowledgement", () => {
  const app = new App({ env: "production" });
  assert.throws(
    () =>
      app.ws("/ws", {
        beforeUpgrade() {
          return undefined;
        },
        open() {},
      }),
    /CSWSH|allowedOrigins|acknowledgeCrossOriginUpgrade/s
  );
});

test("CSWSH: production app.ws() accepts allowedOrigins: 'same-origin'", () => {
  const app = new App({ env: "production" });
  app.ws("/ws", {
    allowedOrigins: "same-origin",
    beforeUpgrade() {
      return undefined;
    },
    open() {},
  });
});

test("CSWSH: production app.ws() accepts allowedOrigins string[]", () => {
  const app = new App({ env: "production" });
  app.ws("/ws", {
    allowedOrigins: ["https://app.example.com"],
    beforeUpgrade() {
      return undefined;
    },
    open() {},
  });
});

test("CSWSH: app.ws() refuses invalid allowedOrigins runtime values", () => {
  const app = new App({ env: "production" });
  assert.throws(
    () =>
      app.ws("/ws", {
        allowedOrigins: "https://app.example.com" as any,
        beforeUpgrade() {
          return undefined;
        },
        open() {},
      }),
    /allowedOrigins.*same-origin.*array.*predicate/s
  );
});

test("CSWSH: production app.ws() accepts acknowledgeCrossOriginUpgrade: true", () => {
  const app = new App({ env: "production" });
  app.ws("/public", {
    acknowledgeUnauthenticated: true,
    acknowledgeCrossOriginUpgrade: true,
    open() {},
  });
});

test("CSWSH: dev app.ws() (non-production) does not require Origin policy", () => {
  const app = new App();
  // Should not throw — the CSWSH refuse-at-registration only fires in
  // production under secureDefaults so unit tests and dev runs stay
  // friction-free.
  app.ws("/ws", { open() {} });
});

// ---------- Runtime checker ----------

function makeRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "GET", headers });
}

test("CSWSH: checkWebSocketOrigin('same-origin') allows matching Origin", () => {
  const req = makeRequest("https://api.example.com/ws", {
    origin: "https://api.example.com",
  });
  assert.deepEqual(checkWebSocketOrigin(req, "same-origin"), { ok: true });
});

test("CSWSH: checkWebSocketOrigin('same-origin') rejects cross-origin handshake", () => {
  const req = makeRequest("https://api.example.com/ws", {
    origin: "https://evil.example",
  });
  const result = checkWebSocketOrigin(req, "same-origin");
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /cross-origin/);
});

test("CSWSH: checkWebSocketOrigin('same-origin') allows missing Origin (non-browser client)", () => {
  const req = makeRequest("https://api.example.com/ws");
  assert.deepEqual(checkWebSocketOrigin(req, "same-origin"), { ok: true });
});

test("CSWSH: checkWebSocketOrigin([...]) accepts allowlisted origin", () => {
  const req = makeRequest("https://api.example.com/ws", {
    origin: "https://app.example.com",
  });
  assert.deepEqual(checkWebSocketOrigin(req, ["https://app.example.com"]), { ok: true });
});

test("CSWSH: checkWebSocketOrigin([...]) rejects non-allowlisted origin", () => {
  const req = makeRequest("https://api.example.com/ws", {
    origin: "https://evil.example",
  });
  const result = checkWebSocketOrigin(req, ["https://app.example.com"]);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /allowlisted/);
});

test("CSWSH: checkWebSocketOrigin([...]) allows missing Origin (non-browser client)", () => {
  const req = makeRequest("https://api.example.com/ws");
  assert.deepEqual(checkWebSocketOrigin(req, ["https://app.example.com"]), { ok: true });
});

test("CSWSH: checkWebSocketOrigin(predicate) gives full control", () => {
  const req = makeRequest("https://api.example.com/ws", { origin: "null" });
  assert.deepEqual(
    checkWebSocketOrigin(req, (origin) => origin === "null"),
    { ok: true }
  );
  const blocked = checkWebSocketOrigin(req, (origin) => origin !== "null");
  assert.equal(blocked.ok, false);
});

test("CSWSH: checkWebSocketOrigin(predicate) can require Origin be present", () => {
  const reqMissing = makeRequest("https://api.example.com/ws");
  const result = checkWebSocketOrigin(
    reqMissing,
    (origin) => origin !== null && origin === "https://app.example.com"
  );
  assert.equal(result.ok, false);
});

test("CSWSH: checkWebSocketOrigin(undefined) is a no-op (no policy = allow)", () => {
  const req = makeRequest("https://api.example.com/ws", {
    origin: "https://evil.example",
  });
  assert.deepEqual(checkWebSocketOrigin(req, undefined), { ok: true });
});

test("CSWSH: checkWebSocketOrigin invalid runtime policy fails closed", () => {
  const req = makeRequest("https://api.example.com/ws", {
    origin: "https://app.example.com",
  });
  const result = checkWebSocketOrigin(req, "https://app.example.com" as any);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /invalid/);
});

test("CSWSH: checkWebSocketOrigin(predicate) thrown error rejects safely", () => {
  const req = makeRequest("https://api.example.com/ws", {
    origin: "https://app.example.com",
  });
  const result = checkWebSocketOrigin(req, () => {
    throw new Error("boom");
  });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /failed/);
});

// ---------- End-to-end: Origin enforcement on the Node adapter ----------

import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { serve as serveNode } from "../src/adapters/node.js";

async function rawUpgrade(
  port: number,
  path: string,
  extraHeaders: Record<string, string>
): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const headers: Record<string, string> = {
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-version": "13",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      ...extraHeaders,
    };
    const req = httpRequest({ port, path, method: "GET", headers });
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      res.on("data", () => {});
      res.on("end", () => resolve(status));
      res.on("close", () => resolve(status));
    });
    req.on("upgrade", (res) => {
      resolve(res.statusCode ?? 101);
    });
    req.on("error", reject);
    req.end();
  });
}

test("CSWSH: Node adapter rejects cross-origin upgrade with 403 before beforeUpgrade runs", async () => {
  const app = new App({ logger: false });
  let beforeUpgradeRan = false;
  app.ws("/ws", {
    allowedOrigins: ["https://app.example.com"],
    beforeUpgrade() {
      beforeUpgradeRan = true;
      return undefined;
    },
    open() {},
  });
  const handle = serveNode(app, { port: 0, handleSignals: false });
  await once(handle.server, "listening");
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const status = await rawUpgrade(port, "/ws", {
      origin: "https://evil.example",
    });
    assert.equal(status, 403);
    assert.equal(beforeUpgradeRan, false);
  } finally {
    await handle.close();
  }
});

test("CSWSH: Node adapter allows allowlisted origin upgrade through to beforeUpgrade", async () => {
  const app = new App({ logger: false });
  let beforeUpgradeRan = false;
  app.ws("/ws", {
    allowedOrigins: ["https://app.example.com"],
    beforeUpgrade() {
      beforeUpgradeRan = true;
      // Reject after the origin check so we don't actually complete the
      // 101 handshake; the assertion is that beforeUpgrade ran at all,
      // proving the Origin check passed.
      return new Response("nope", { status: 401 });
    },
    open() {},
  });
  const handle = serveNode(app, { port: 0, handleSignals: false });
  await once(handle.server, "listening");
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const status = await rawUpgrade(port, "/ws", {
      origin: "https://app.example.com",
    });
    assert.equal(status, 401);
    assert.equal(beforeUpgradeRan, true);
  } finally {
    await handle.close();
  }
});
