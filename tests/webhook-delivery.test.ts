import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWebhookSender,
  MemoryWebhookDeadLetterSink,
  verifyWebhookSignature,
  type WebhookAttempt,
} from "../src/index.js";

const SECRET = "whsec_test_0123456789abcdef0123456789abcdef";

// A scripted transport: each step returns a Response or throws.
type Step = (url: string, init: RequestInit) => Promise<Response> | Response;

function scriptedTransport(steps: Step[]): {
  fetch: typeof fetch;
  requests: Array<{ url: string; init: RequestInit }>;
} {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fn = (async (input: Request | string | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ url, init: init ?? {} });
    const step = steps[Math.min(i++, steps.length - 1)];
    return step!(url, init ?? {});
  }) as unknown as typeof fetch;
  return { fetch: fn, requests };
}

function ok(): Step {
  return () => new Response("ok", { status: 200 });
}
function status(code: number, headers?: Record<string, string>): Step {
  return () => new Response("nope", { status: code, headers });
}
function netError(): Step {
  return () => {
    throw new TypeError("connection reset");
  };
}

const noSleep = async (): Promise<void> => undefined;

// ── signed delivery (happy path) ────────────────────────────────────

test("createWebhookSender: delivers a signed POST a receiver can verify", async () => {
  const { fetch: transport, requests } = scriptedTransport([ok()]);
  const send = createWebhookSender({
    secret: SECRET,
    fetch: transport,
    now: () => 1_700_000_000_000,
  });

  const result = await send({
    url: "https://hooks.example.com/x",
    eventType: "invoice.paid",
    payload: { id: "in_1" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.status, 200);
  assert.equal(result.deadLettered, false);

  const req = requests[0]!;
  assert.equal(req.init.method, "POST");
  const headers = new Headers(req.init.headers as HeadersInit);
  assert.ok(headers.get("webhook-id"));
  assert.equal(headers.get("webhook-timestamp"), "1700000000");
  assert.equal(headers.get("webhook-event-type"), "invoice.paid");
  assert.equal(headers.get("content-type"), "application/json");
  const sigHeader = headers.get("webhook-signature")!;
  assert.match(sigHeader, /^sha256=/);

  // The receiver can verify the signature over "<timestamp>.<body>".
  const body = req.init.body as Uint8Array;
  const verified = await verifyWebhookSignature({
    payload: body,
    signature: sigHeader,
    secret: SECRET,
    timestamp: 1700000000,
    now: () => 1_700_000_000_000,
  });
  assert.equal(verified, true);
});

test("createWebhookSender: uses the supplied idempotency id", async () => {
  const { fetch: transport, requests } = scriptedTransport([ok()]);
  const send = createWebhookSender({ secret: SECRET, fetch: transport });
  const result = await send({ url: "https://h.example.com/", id: "evt_fixed", payload: {} });
  assert.equal(result.id, "evt_fixed");
  const headers = new Headers(requests[0]!.init.headers as HeadersInit);
  assert.equal(headers.get("webhook-id"), "evt_fixed");
});

test("createWebhookSender: a string payload is sent verbatim, bytes as octet-stream", async () => {
  const { fetch: transport, requests } = scriptedTransport([ok(), ok()]);
  const send = createWebhookSender({ secret: SECRET, fetch: transport });
  await send({ url: "https://h/", payload: '{"raw":true}' });
  await send({ url: "https://h/", payload: new Uint8Array([1, 2, 3]) });
  assert.equal(
    new Headers(requests[0]!.init.headers as HeadersInit).get("content-type"),
    "application/json"
  );
  assert.equal(
    new Headers(requests[1]!.init.headers as HeadersInit).get("content-type"),
    "application/octet-stream"
  );
});

test("createWebhookSender: caller headers cannot clobber signature headers", async () => {
  const { fetch: transport, requests } = scriptedTransport([ok()]);
  const send = createWebhookSender({ secret: SECRET, fetch: transport });
  await send({
    url: "https://h/",
    id: "real",
    payload: {},
    headers: { "webhook-id": "spoofed", "x-custom": "kept" },
  });
  const headers = new Headers(requests[0]!.init.headers as HeadersInit);
  assert.equal(headers.get("webhook-id"), "real"); // not overwritten
  assert.equal(headers.get("x-custom"), "kept");
});

// ── retry with backoff ──────────────────────────────────────────────

test("createWebhookSender: retries a 503 then succeeds, signature stable across retries", async () => {
  const seen: WebhookAttempt[] = [];
  const { fetch: transport, requests } = scriptedTransport([status(503), status(503), ok()]);
  const send = createWebhookSender({
    secret: SECRET,
    fetch: transport,
    sleep: noSleep,
    jitter: false,
    onAttempt: (a) => seen.push(a),
  });
  const result = await send({ url: "https://h/", id: "evt_1", payload: { n: 1 } });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(seen.length, 3);
  assert.equal(seen[0]?.willRetry, true);
  assert.equal(seen[2]?.willRetry, false);
  // Same id + signature on every attempt (receiver can dedupe).
  const sigs = requests.map((r) =>
    new Headers(r.init.headers as HeadersInit).get("webhook-signature")
  );
  assert.equal(new Set(sigs).size, 1);
  const ids = requests.map((r) => new Headers(r.init.headers as HeadersInit).get("webhook-id"));
  assert.deepEqual(ids, ["evt_1", "evt_1", "evt_1"]);
});

test("createWebhookSender: retries a network error", async () => {
  const { fetch: transport } = scriptedTransport([netError(), ok()]);
  const send = createWebhookSender({
    secret: SECRET,
    fetch: transport,
    sleep: noSleep,
    jitter: false,
  });
  const result = await send({ url: "https://h/", payload: {} });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test("createWebhookSender: honours Retry-After header (capped)", async () => {
  const delays: number[] = [];
  const { fetch: transport } = scriptedTransport([status(429, { "retry-after": "3" }), ok()]);
  const send = createWebhookSender({
    secret: SECRET,
    fetch: transport,
    maxRetryDelayMs: 10_000,
    sleep: async (ms) => {
      delays.push(ms);
    },
    now: () => 0,
  });
  await send({ url: "https://h/", payload: {} });
  assert.deepEqual(delays, [3_000]);
});

test("createWebhookSender: does NOT retry a permanent 400", async () => {
  const { fetch: transport, requests } = scriptedTransport([status(400), ok()]);
  const send = createWebhookSender({ secret: SECRET, fetch: transport, sleep: noSleep });
  const result = await send({ url: "https://h/", payload: {} });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.attempts, 1); // not retried
  assert.equal(requests.length, 1);
});

// ── dead-letter semantics ───────────────────────────────────────────

test("createWebhookSender: dead-letters after exhausting all attempts", async () => {
  const sink = new MemoryWebhookDeadLetterSink();
  const { fetch: transport } = scriptedTransport([status(503)]); // always 503
  const send = createWebhookSender({
    secret: SECRET,
    fetch: transport,
    maxAttempts: 3,
    sleep: noSleep,
    deadLetter: sink,
    now: () => 1_700_000_000_000,
  });
  const result = await send({ url: "https://h/", eventType: "x.y", payload: { a: 1 } });
  assert.equal(result.ok, false);
  assert.equal(result.deadLettered, true);
  assert.equal(result.attempts, 3);
  assert.equal(sink.size, 1);
  const letter = sink.list()[0]!;
  assert.equal(letter.url, "https://h/");
  assert.equal(letter.eventType, "x.y");
  assert.equal(letter.attempts, 3);
  assert.equal(letter.lastStatus, 503);
  assert.equal(letter.timestamp, 1700000000);
  assert.ok(letter.payload instanceof Uint8Array);
});

test("createWebhookSender: dead-letters a network failure with lastError set", async () => {
  const sink = new MemoryWebhookDeadLetterSink();
  const { fetch: transport } = scriptedTransport([netError()]);
  const send = createWebhookSender({
    secret: SECRET,
    fetch: transport,
    maxAttempts: 2,
    sleep: noSleep,
    deadLetter: sink,
  });
  const result = await send({ url: "https://h/", payload: {} });
  assert.equal(result.deadLettered, true);
  assert.equal(sink.list()[0]?.lastError, "connection reset");
});

test("createWebhookSender: without a sink, failure reports deadLettered:false", async () => {
  const { fetch: transport } = scriptedTransport([status(500)]);
  const send = createWebhookSender({
    secret: SECRET,
    fetch: transport,
    maxAttempts: 1,
    sleep: noSleep,
  });
  const result = await send({ url: "https://h/", payload: {} });
  assert.equal(result.ok, false);
  assert.equal(result.deadLettered, false);
});

test("MemoryWebhookDeadLetterSink: drain empties and returns, ring buffer caps size", () => {
  const sink = new MemoryWebhookDeadLetterSink(2);
  for (let i = 0; i < 3; i++) {
    sink.add({
      id: String(i),
      url: "https://h/",
      payload: new Uint8Array(),
      contentType: "application/json",
      attempts: 1,
      timestamp: 0,
      failedAt: 0,
    });
  }
  assert.equal(sink.size, 2); // oldest evicted
  assert.deepEqual(
    sink.list().map((l) => l.id),
    ["1", "2"]
  );
  const drained = sink.drain();
  assert.equal(drained.length, 2);
  assert.equal(sink.size, 0);
});

test("MemoryWebhookDeadLetterSink: rejects invalid capacity", () => {
  assert.throws(() => new MemoryWebhookDeadLetterSink(0), RangeError);
  assert.throws(() => new MemoryWebhookDeadLetterSink(-5), RangeError);
});

// ── SSRF default posture ────────────────────────────────────────────

test("createWebhookSender: default transport refuses SSRF targets, dead-letters once", async () => {
  const sink = new MemoryWebhookDeadLetterSink();
  // No fetch override → defaults to fetchGuard(), which blocks 169.254.169.254.
  const send = createWebhookSender({
    secret: SECRET,
    maxAttempts: 4,
    sleep: noSleep,
    deadLetter: sink,
  });
  const result = await send({ url: "http://169.254.169.254/latest/meta-data/", payload: {} });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1); // SSRF refusal is permanent, not retried
  assert.equal(sink.size, 1);
  assert.match(String(sink.list()[0]?.lastError), /SSRF/i);
});

// ── per-attempt timeout ─────────────────────────────────────────────

test("createWebhookSender: a stalled attempt is aborted and retried", async () => {
  let aborted = 0;
  const stall: Step = (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        aborted++;
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  const { fetch: transport } = scriptedTransport([stall, ok()]);
  const send = createWebhookSender({
    secret: SECRET,
    fetch: transport,
    timeoutMs: 10,
    sleep: noSleep,
  });
  const result = await send({ url: "https://h/", payload: {} });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(aborted, 1);
});

// ── validation ──────────────────────────────────────────────────────

test("createWebhookSender: rejects an empty secret and bad options", () => {
  assert.throws(() => createWebhookSender({ secret: "" }), /signing secret is required/);
  assert.throws(() => createWebhookSender({ secret: SECRET, maxAttempts: 0 }), RangeError);
  assert.throws(() => createWebhookSender({ secret: SECRET, timeoutMs: -1 }), RangeError);
});

test("createWebhookSender: custom header names and algorithm are honoured", async () => {
  const { fetch: transport, requests } = scriptedTransport([ok()]);
  const send = createWebhookSender({
    secret: SECRET,
    fetch: transport,
    algorithm: "sha512",
    idHeader: "x-id",
    signatureHeader: "x-sig",
    timestampHeader: "x-ts",
    eventTypeHeader: "x-type",
    userAgent: "MyApp/2",
  });
  await send({ url: "https://h/", eventType: "t", payload: {} });
  const h = new Headers(requests[0]!.init.headers as HeadersInit);
  assert.ok(h.get("x-id"));
  assert.ok(h.get("x-ts"));
  assert.match(h.get("x-sig")!, /^sha512=/);
  assert.equal(h.get("x-type"), "t");
  assert.equal(h.get("user-agent"), "MyApp/2");
});
