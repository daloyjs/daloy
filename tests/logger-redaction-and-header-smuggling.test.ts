import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  createLogger,
  noopLogger,
  DEFAULT_REDACT_KEYS,
  assertNoDuplicateSingletonHeaders,
  SMUGGLING_SINGLETON_HEADERS,
  verifyWebhookSignature,
  signWebhookPayload,
  BadRequestError,
} from "../src/index.js";

// ---------- Logger redaction ----------

test("createLogger redacts default sensitive keys", () => {
  const lines: string[] = [];
  const log = createLogger({
    level: "info",
    write: (l) => lines.push(l),
  });
  log.info(
    {
      authorization: "Bearer xyz",
      cookie: "sid=abc",
      password: "hunter2",
      token: "t",
      nested: { apikey: "secret" },
      keep: "ok",
    },
    "hi",
  );
  const obj = JSON.parse(lines[0]!);
  assert.equal(obj.authorization, "[REDACTED]");
  assert.equal(obj.cookie, "[REDACTED]");
  assert.equal(obj.password, "[REDACTED]");
  assert.equal(obj.token, "[REDACTED]");
  assert.equal(obj.nested.apikey, "[REDACTED]");
  assert.equal(obj.keep, "ok");
  assert.equal(obj.msg, "hi");
});

test("createLogger redacts JWT-shaped strings anywhere", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123";
  log.info({ payload: jwt, list: [jwt, "ok"] });
  const obj = JSON.parse(lines[0]!);
  assert.equal(obj.payload, "[REDACTED]");
  assert.deepEqual(obj.list, ["[REDACTED]", "ok"]);
});

test("createLogger redaction can be disabled and extended", () => {
  const off: string[] = [];
  const offLog = createLogger({ level: "info", write: (l) => off.push(l), redact: false });
  offLog.info({ password: "leak" });
  assert.equal(JSON.parse(off[0]!).password, "leak");

  const ext: string[] = [];
  const extLog = createLogger({
    level: "info",
    write: (l) => ext.push(l),
    redact: { keys: ["session-id"], censor: "***" },
  });
  extLog.info({ "session-id": "abc", token: "t" });
  const obj = JSON.parse(ext[0]!);
  assert.equal(obj["session-id"], "***");
  assert.equal(obj.token, "***");
});

test("createLogger child inherits redaction config", () => {
  const lines: string[] = [];
  const parent = createLogger({ level: "info", write: (l) => lines.push(l) });
  parent.child({ requestId: "r1" }).info({ password: "leak" }, "x");
  const obj = JSON.parse(lines[0]!);
  assert.equal(obj.password, "[REDACTED]");
  assert.equal(obj.requestId, "r1");
});

test("DEFAULT_REDACT_KEYS includes the documented set", () => {
  for (const k of ["authorization", "cookie", "set-cookie", "password", "token"]) {
    assert.ok(DEFAULT_REDACT_KEYS.includes(k));
  }
});

test("DEFAULT_REDACT_KEYS includes AI provider credential headers (LiteLLM blast-radius pattern)", () => {
  // Headers commonly carrying LLM provider keys when an app brokers
  // prompts to OpenAI / Anthropic / Google / Azure / Cohere / Mistral /
  // Groq / Replicate / HuggingFace, or runs an AI gateway like LiteLLM.
  // A single log of a request with one of these set must not leak the
  // credential into log aggregators. See SECURITY.md § "AI gateway
  // blast radius (LiteLLM 2026 pattern)".
  for (const k of [
    "openai-api-key",
    "x-openai-api-key",
    "anthropic-api-key",
    "x-anthropic-api-key",
    "x-goog-api-key",
    "azure-api-key",
    "cohere-api-key",
    "mistral-api-key",
    "groq-api-key",
    "replicate-api-token",
    "huggingface-api-key",
    "x-litellm-master-key",
    "litellm-master-key",
    "litellm-api-key",
  ]) {
    assert.ok(DEFAULT_REDACT_KEYS.includes(k), `${k} should be in DEFAULT_REDACT_KEYS`);
  }
});

test("logger redacts AI provider keys case-insensitively", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  log.info(
    {
      "X-OpenAI-Api-Key": "sk-leak-openai",
      "anthropic-api-key": "sk-ant-leak",
      "X-Goog-Api-Key": "AIzaLeakGoogle",
      "x-litellm-master-key": "sk-litellm-leak",
    },
    "ai-call",
  );
  const obj = JSON.parse(lines[0]!);
  assert.equal(obj["X-OpenAI-Api-Key"], "[REDACTED]");
  assert.equal(obj["anthropic-api-key"], "[REDACTED]");
  assert.equal(obj["X-Goog-Api-Key"], "[REDACTED]");
  assert.equal(obj["x-litellm-master-key"], "[REDACTED]");
});

test("redaction does not crash on cycles or arrays", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  const a: any = { token: "t" };
  a.self = a;
  log.info(a, "cycle");
  const parsed = lines[0]!;
  // Parsing may fail due to cycle in JSON.stringify — but redaction itself must
  // have run, so the fallback line should be emitted.
  assert.match(parsed, /<unserializable log>|REDACTED/);
});

// ---------- Strip Server / X-Powered-By ----------

test("Server and X-Powered-By are stripped from every response", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/leak",
    operationId: "leak",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async ({ set }) => {
      set.headers.set("server", "DaloyJS/1.0");
      set.headers.set("x-powered-by", "DaloyJS");
      return { status: 200 as const, body: { ok: true } };
    },
  });
  const res = await app.request("/leak");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("server"), null);
  assert.equal(res.headers.get("x-powered-by"), null);
});

test("stripServerHeaders: false preserves the headers", async () => {
  const app = new App({ logger: false, stripServerHeaders: false });
  app.route({
    method: "GET",
    path: "/keep",
    operationId: "keep",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async ({ set }) => {
      set.headers.set("server", "DaloyJS/1.0");
      return { status: 200 as const, body: { ok: true } };
    },
  });
  const res = await app.request("/keep");
  assert.equal(res.headers.get("server"), "DaloyJS/1.0");
});

// ---------- Duplicate singleton headers ----------

test("assertNoDuplicateSingletonHeaders accepts a single Host", () => {
  const h = new Headers({ host: "example.com", "content-length": "0" });
  assert.doesNotThrow(() => assertNoDuplicateSingletonHeaders(h));
});

test("assertNoDuplicateSingletonHeaders rejects duplicate Host", () => {
  const h = new Headers();
  h.append("host", "a.example");
  h.append("host", "b.example");
  assert.throws(() => assertNoDuplicateSingletonHeaders(h), BadRequestError);
});

test("assertNoDuplicateSingletonHeaders rejects duplicate Content-Length", () => {
  const h = new Headers();
  h.append("content-length", "10");
  h.append("content-length", "20");
  assert.throws(() => assertNoDuplicateSingletonHeaders(h), BadRequestError);
});

test("App rejects requests carrying duplicate Host header with 400", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const headers = new Headers();
  headers.append("host", "a.example");
  headers.append("host", "b.example");
  const res = await app.fetch(new Request("http://localhost/ok", { headers }));
  assert.equal(res.status, 400);
});

test("duplicate Host is rejected before user onRequest hooks run", async () => {
  let called = false;
  const app = new App({
    logger: false,
    hooks: {
      onRequest: () => {
        called = true;
      },
    },
  });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const headers = new Headers();
  headers.append("host", "a.example");
  headers.append("host", "b.example");
  const res = await app.fetch(new Request("http://localhost/ok", { headers }));
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test("SMUGGLING_SINGLETON_HEADERS exposes host and content-length", () => {
  assert.ok(SMUGGLING_SINGLETON_HEADERS.includes("host"));
  assert.ok(SMUGGLING_SINGLETON_HEADERS.includes("content-length"));
});

// ---------- Webhook HMAC ----------

test("signWebhookPayload + verifyWebhookSignature roundtrip (hex)", async () => {
  const secret = "shhh";
  const payload = new TextEncoder().encode('{"event":"ping"}');
  const sig = await signWebhookPayload({ payload, secret });
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(
    await verifyWebhookSignature({ payload, signature: sig, secret }),
    true,
  );
});

test("verifyWebhookSignature accepts sha256= prefix", async () => {
  const secret = "k";
  const payload = "hello";
  const sig = await signWebhookPayload({ payload, secret });
  assert.equal(
    await verifyWebhookSignature({
      payload,
      signature: `sha256=${sig}`,
      secret,
    }),
    true,
  );
});

test("verifyWebhookSignature accepts base64-encoded signatures", async () => {
  const secret = "k";
  const payload = "hello";
  const hex = await signWebhookPayload({ payload, secret });
  // Convert hex -> base64
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  const b64 = Buffer.from(bytes).toString("base64");
  assert.equal(
    await verifyWebhookSignature({ payload, signature: b64, secret }),
    true,
  );
});

test("verifyWebhookSignature accepts padded base64 without treating padding as a prefix", async () => {
  const payload = "payload-3";
  const secret = "k";
  const signature = "qu48YYDwTExIPPVUjRLGjNZPIz8BDPL6NtxfZ71w4es=";
  assert.equal(
    await verifyWebhookSignature({ payload, signature, secret }),
    true,
  );
});

test("verifyWebhookSignature rejects mismatched or deprecated algorithm prefixes", async () => {
  const payload = "hello";
  const secret = "k";
  const sha256 = await signWebhookPayload({ payload, secret });
  assert.equal(
    await verifyWebhookSignature({ payload, signature: `sha512=${sha256}`, secret }),
    false,
  );
  assert.equal(
    await verifyWebhookSignature({ payload, signature: `sha1=${sha256}`, secret }),
    false,
  );
});

test("verifyWebhookSignature returns false on tampered payload", async () => {
  const secret = "k";
  const sig = await signWebhookPayload({ payload: "hello", secret });
  assert.equal(
    await verifyWebhookSignature({ payload: "hello!", signature: sig, secret }),
    false,
  );
});

test("verifyWebhookSignature returns false on malformed signature", async () => {
  assert.equal(
    await verifyWebhookSignature({
      payload: "x",
      signature: "not-hex-or-b64!!!",
      secret: "k",
    }),
    false,
  );
});

test("verifyWebhookSignature works with sha512 and Uint8Array signature", async () => {
  const secret = new TextEncoder().encode("k");
  const payload = "hello";
  const hex = await signWebhookPayload({ payload, secret, algorithm: "sha512" });
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  assert.equal(
    await verifyWebhookSignature({
      payload,
      signature: bytes,
      secret,
      algorithm: "sha512",
    }),
    true,
  );
});

test("signWebhookPayload supports sha384", async () => {
  const sig = await signWebhookPayload({ payload: "x", secret: "k", algorithm: "sha384" });
  assert.match(sig, /^[0-9a-f]{96}$/);
});

test("signWebhookPayload rejects unsupported runtime algorithms", async () => {
  await assert.rejects(
    () => signWebhookPayload({ payload: "x", secret: "k", algorithm: "sha1" as any }),
    TypeError,
  );
});

test("verifyWebhookSignature rejects Uint8Array signatures of wrong length", async () => {
  assert.equal(
    await verifyWebhookSignature({
      payload: "x",
      signature: new Uint8Array(8),
      secret: "k",
    }),
    false,
  );
});

test("verifyWebhookSignature rejects empty signature strings", async () => {
  assert.equal(
    await verifyWebhookSignature({ payload: "x", signature: "", secret: "k" }),
    false,
  );
  assert.equal(
    await verifyWebhookSignature({
      payload: "x",
      signature: "sha256=",
      secret: "k",
    }),
    false,
  );
});

test("verifyWebhookSignature rejects base64 strings with invalid padding length", async () => {
  assert.equal(
    await verifyWebhookSignature({ payload: "x", signature: "AAAAA", secret: "k" }),
    false,
  );
});

test("verifyWebhookSignature returns false on bogus runtime algorithm value", async () => {
  assert.equal(
    await verifyWebhookSignature({
      payload: "x",
      signature: "00",
      secret: "k",
      algorithm: "md5" as any,
    }),
    false,
  );
});

// ---------- env option + NODE_ENV mismatch ----------

test("App.env: 'production' takes precedence over NODE_ENV", async () => {
  const app = new App({ logger: false, env: "production" });
  app.route({
    method: "GET",
    path: "/boom",
    operationId: "boom",
    responses: { 500: { description: "err", body: z.object({}).passthrough() as any } },
    handler: async () => {
      throw new Error("internal-leak-message");
    },
  });
  const res = await app.request("/boom");
  assert.equal(res.status, 500);
  const body = await res.json();
  // Production mode hides the underlying error message.
  assert.notEqual(body.detail, "internal-leak-message");
});

test("App warns when env disagrees with NODE_ENV", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const warns: any[] = [];
    const log = {
      ...noopLogger,
      warn: (obj: any) => warns.push(obj),
    };
    new App({ logger: log, env: "development" });
    assert.equal(warns.length, 1);
    assert.equal(warns[0].event, "env.mismatch");
    assert.equal(warns[0].env, "development");
    assert.equal(warns[0].nodeEnv, "production");
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});

test("App stays silent when env matches NODE_ENV", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const warns: any[] = [];
    const log = { ...noopLogger, warn: (obj: any) => warns.push(obj) };
    new App({ logger: log, env: "development" });
    assert.equal(warns.length, 0);
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});

test("App stays silent when env is omitted (no mismatch possible)", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const warns: any[] = [];
    const log = { ...noopLogger, warn: (obj: any) => warns.push(obj) };
    new App({ logger: log });
    assert.equal(warns.length, 0);
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});
