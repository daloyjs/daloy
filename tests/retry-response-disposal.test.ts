import assert from "node:assert/strict";
import { test } from "node:test";
import { CircuitBreaker, resilientFetch } from "../src/fetch-resilience.js";
import { createWebhookSender } from "../src/webhook-delivery.js";

for (const phase of ["fetch", "backoff"] as const) {
  test(`custom caller abort during ${phase} never retries or counts as upstream failure`, async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled this operation");
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    let calls = 0;
    let retries = 0;
    const transport = (async () => {
      calls++;
      if (phase === "fetch") {
        controller.abort(reason);
        throw reason;
      }
      return new Response("retryable", { status: 503 });
    }) as typeof fetch;
    const request = resilientFetch({
      fetch: transport,
      circuitBreaker: breaker,
      onRetry() { retries++; },
      sleep: async () => { controller.abort(reason); },
    });
    await assert.rejects(request("https://upstream.test/", { signal: controller.signal }), error => error === reason);
    assert.equal(calls, 1);
    assert.equal(retries, phase === "fetch" ? 0 : 1);
    assert.equal(breaker.state, "closed");
  });
}

for (const kind of ["resilientFetch", "webhook"] as const) {
  test(`${kind} cancels discarded retry bodies but preserves the final response`, async () => {
    let cancelled = 0;
    let calls = 0;
    const transport = (async () => {
      calls++;
      if (calls === 1) {
        return new Response(new ReadableStream({ cancel() { cancelled++; return new Promise<void>(() => {}); } }), { status: 503 });
      }
      return new Response("final body");
    }) as typeof fetch;
    const sleep = async () => { assert.equal(cancelled, 1, "discarded body must be cancelled before backoff"); };
    const response = kind === "resilientFetch"
      ? await resilientFetch({ fetch: transport, sleep, retries: 1, circuitBreaker: false })("https://upstream.test/")
      : (await createWebhookSender({ secret: "test-secret-for-local-delivery-only", fetch: transport, sleep, maxAttempts: 2 })({ url: "https://upstream.test/", payload: "body" })).response;
    assert.equal(calls, 2);
    assert.equal(cancelled, 1);
    assert.equal(await response?.text(), "final body");
  });
}