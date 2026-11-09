import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App } from "../src/index.js";

function leakyApp(options: ConstructorParameters<typeof App>[0]): App {
  const app = new App({ logger: false, ...options });
  app.route({
    method: "GET",
    path: "/leak",
    operationId: "leak",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: async ({ set }) => {
      set.headers.set("server", "nginx/1.0");
      set.headers.set("x-powered-by", "Express");
      return { status: 200 as const, body: { ok: true } };
    },
  });
  return app;
}

// ---------- happy paths ----------

test("poweredBy: true advertises a versionless X-Powered-By: DaloyJS", async () => {
  const res = await leakyApp({ poweredBy: true }).request("/leak");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-powered-by"), "DaloyJS");
  // The Server header is still stripped.
  assert.equal(res.headers.get("server"), null);
});

test("poweredBy string is sent verbatim and replaces any handler value", async () => {
  const res = await leakyApp({ poweredBy: "DaloyJS/1.19.0" }).request("/leak");
  assert.equal(res.headers.get("x-powered-by"), "DaloyJS/1.19.0");
});

test("poweredBy is stamped on framework-generated responses (404)", async () => {
  const res = await leakyApp({ poweredBy: true }).request("/nope");
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("x-powered-by"), "DaloyJS");
});

test("poweredBy survives an onSend hook that tries to override it", async () => {
  const app = leakyApp({ poweredBy: true });
  app.use({
    onSend: (res) => {
      res.headers.set("x-powered-by", "PHP/5.4");
    },
  });
  const res = await app.request("/leak");
  assert.equal(res.headers.get("x-powered-by"), "DaloyJS");
});

test("getSecurityPosture reports the advertised value", () => {
  assert.equal(new App({ logger: false }).getSecurityPosture().poweredBy, false);
  assert.equal(
    new App({ logger: false, poweredBy: true }).getSecurityPosture().poweredBy,
    "DaloyJS",
  );
});

// ---------- unhappy paths ----------

test("by default no X-Powered-By is sent, even when a handler sets one", async () => {
  for (const poweredBy of [undefined, false] as const) {
    const res = await leakyApp({ poweredBy }).request("/leak");
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.equal(res.headers.get("server"), null);
  }
});

test("poweredBy rejects header-injection and malformed values at boot", () => {
  const bad: unknown[] = [
    "",
    " DaloyJS",
    "DaloyJS ",
    "DaloyJS\r\nSet-Cookie: x=1",
    "DaloyJS\n",
    "Daloy\u0000JS",
    "Dalöy",
    "x".repeat(129),
    42,
    {},
  ];
  for (const value of bad) {
    assert.throws(
      () => new App({ logger: false, poweredBy: value as string }),
      /app\(\{ poweredBy \}\) must be true or 1-128 printable ASCII/,
      `expected ${JSON.stringify(value)} to be refused`,
    );
  }
  // Boundary: exactly 128 characters is accepted.
  assert.doesNotThrow(() => new App({ logger: false, poweredBy: "x".repeat(128) }));
});

test("poweredBy cannot be combined with stripServerHeaders: false", () => {
  assert.throws(
    () => new App({ logger: false, poweredBy: true, stripServerHeaders: false }),
    /cannot be combined with stripServerHeaders: false/,
  );
  // stripServerHeaders: false alone still works and leaves headers untouched.
  assert.doesNotThrow(() => new App({ logger: false, stripServerHeaders: false }));
});
