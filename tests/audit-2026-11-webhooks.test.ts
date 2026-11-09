import { test } from "node:test";
import assert from "node:assert/strict";
import { signWebhookPayload, verifyWebhookSignature } from "../src/security.js";
import { createWebhookSender } from "../src/webhook-delivery.js";

// Regression tests for the 2026-11 audit: the outbound webhook signature
// must cover the message id so a captured delivery cannot be replayed with
// a fresh `webhook-id` to slip past receiver-side dedupe.

const SECRET = "whsec_test_0123456789abcdef0123456789abcdef";
const NOW_MS = 1_700_000_000_000;
const TS = 1_700_000_000;

async function captureDelivery(event: { id?: string; eventType?: string; payload: unknown }) {
  let captured: { headers: Headers; body: Uint8Array } | undefined;
  const transport = (async (_url: string, init?: RequestInit) => {
    captured = {
      headers: new Headers(init?.headers as HeadersInit),
      body: init?.body as Uint8Array,
    };
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  const send = createWebhookSender({ secret: SECRET, fetch: transport, now: () => NOW_MS });
  await send({ url: "https://hooks.example.com/x", ...event });
  return captured!;
}

/** A receiver that verifies with the id and dedupes on it, as documented. */
function makeReceiver() {
  const seen = new Set<string>();
  const processed: string[] = [];
  return {
    processed,
    async deliver(headers: Headers, body: Uint8Array): Promise<number> {
      const id = headers.get("webhook-id") ?? "";
      const ok = await verifyWebhookSignature({
        payload: body,
        signature: headers.get("webhook-signature") ?? "",
        secret: SECRET,
        id,
        timestamp: headers.get("webhook-timestamp") ?? "",
        now: () => NOW_MS + 60_000,
      });
      if (!ok) return 401;
      if (seen.has(id)) return 200;
      seen.add(id);
      processed.push(id);
      return 200;
    },
  };
}

test("webhook sender: signature binds the id, so a fresh-id replay is refused", async () => {
  const { headers, body } = await captureDelivery({
    id: "evt_1",
    eventType: "invoice.paid",
    payload: { type: "invoice.paid", id: "in_1" },
  });
  const rx = makeReceiver();
  assert.equal(await rx.deliver(headers, body), 200);
  assert.equal(await rx.deliver(headers, body), 200); // legit retry, deduped
  const replay = new Headers(headers);
  replay.set("webhook-id", "evt_attacker_fresh");
  assert.equal(await rx.deliver(replay, body), 401);
  assert.deepEqual(rx.processed, ["evt_1"]);
});

test("webhook sender: the signature is over '<id>.<timestamp>.<body>'", async () => {
  const { headers, body } = await captureDelivery({ id: "evt_2", payload: { a: 1 } });
  const expected = await signWebhookPayload({ payload: body, secret: SECRET, timestamp: TS, id: "evt_2" });
  assert.equal(headers.get("webhook-signature"), `sha256=${expected}`);
  // The old timestamp-only verification no longer matches.
  assert.equal(
    await verifyWebhookSignature({
      payload: body,
      signature: headers.get("webhook-signature")!,
      secret: SECRET,
      timestamp: TS,
      now: () => NOW_MS,
    }),
    false
  );
});

test("webhook sender: a generated UUID id is signed too", async () => {
  const { headers, body } = await captureDelivery({ payload: {} });
  const rx = makeReceiver();
  assert.equal(await rx.deliver(headers, body), 200);
});

test("webhook sender: an id with '.' or non-printable characters is refused", async () => {
  const transport = (async () => new Response("ok")) as unknown as typeof fetch;
  const send = createWebhookSender({ secret: SECRET, fetch: transport });
  await assert.rejects(send({ url: "https://h.example.com/", id: "a.b", payload: {} }), TypeError);
  await assert.rejects(send({ url: "https://h.example.com/", id: "a b", payload: {} }), TypeError);
  await assert.rejects(send({ url: "https://h.example.com/", id: "", payload: {} }), TypeError);
});

test("signWebhookPayload: id requires a timestamp and must be well-formed", async () => {
  await assert.rejects(signWebhookPayload({ payload: "x", secret: SECRET, id: "evt" }), TypeError);
  await assert.rejects(
    signWebhookPayload({ payload: "x", secret: SECRET, timestamp: TS, id: "evt\n" }),
    TypeError
  );
  await assert.rejects(
    signWebhookPayload({ payload: "x", secret: SECRET, timestamp: TS, id: "x".repeat(257) }),
    TypeError
  );
});

test("verifyWebhookSignature: id-bound signatures verify only with the same id", async () => {
  const sig = await signWebhookPayload({ payload: "body", secret: SECRET, timestamp: TS, id: "msg_1" });
  const base = { payload: "body", signature: sig, secret: SECRET, timestamp: TS, now: () => NOW_MS };
  assert.equal(await verifyWebhookSignature({ ...base, id: "msg_1" }), true);
  assert.equal(await verifyWebhookSignature({ ...base, id: "msg_2" }), false);
  assert.equal(await verifyWebhookSignature(base), false);
  // Malformed id, or an id without a timestamp, is a quiet false.
  assert.equal(await verifyWebhookSignature({ ...base, id: "msg.1" }), false);
  const { timestamp: _t, ...noTs } = base;
  assert.equal(await verifyWebhookSignature({ ...noTs, id: "msg_1" }), false);
});

test("verifyWebhookSignature: callers that pass no id keep working", async () => {
  const sig = await signWebhookPayload({ payload: "body", secret: SECRET, timestamp: TS });
  assert.equal(
    await verifyWebhookSignature({ payload: "body", signature: sig, secret: SECRET, timestamp: TS, now: () => NOW_MS }),
    true
  );
  const plain = await signWebhookPayload({ payload: "body", secret: SECRET });
  assert.equal(await verifyWebhookSignature({ payload: "body", signature: plain, secret: SECRET }), true);
});

test("verifyWebhookSignature: matches an independent Standard Webhooks HMAC", async () => {
  const body = '{"type":"invoice.paid"}';
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`msg_9.${TS}.${body}`))
  );
  const b64 = btoa(String.fromCharCode(...mac));
  assert.equal(
    await verifyWebhookSignature({ payload: body, signature: b64, secret: SECRET, id: "msg_9", timestamp: TS, now: () => NOW_MS }),
    true
  );
});

test("verifyWebhookSignature: an empty or missing secret returns false instead of throwing", async () => {
  const sig = await signWebhookPayload({ payload: "body", secret: SECRET });
  assert.equal(await verifyWebhookSignature({ payload: "body", signature: sig, secret: "" }), false);
  assert.equal(
    await verifyWebhookSignature({ payload: "body", signature: sig, secret: new Uint8Array(0) }),
    false
  );
  assert.equal(
    await verifyWebhookSignature({ payload: "body", signature: sig, secret: undefined as unknown as string }),
    false
  );
});
