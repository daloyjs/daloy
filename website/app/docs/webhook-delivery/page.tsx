import { CodeBlock } from "../../../components/code-block";
import { SequenceDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Outbound webhook delivery",
  description:
    "Deliver signed, retried, dead-lettered webhooks from DaloyJS with createWebhookSender(). Timestamped HMAC signatures, exponential backoff, Retry-After, and SSRF-safe transport by default: the outbound counterpart to verifyWebhookSignature().",
  path: "/docs/webhook-delivery",
  keywords: [
    "outbound webhooks",
    "webhook delivery",
    "signed webhooks",
    "webhook retry",
    "dead letter queue",
    "DaloyJS webhooks",
    "createWebhookSender",
    "HMAC signature",
    "Retry-After",
    "Standard Webhooks",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Outbound webhook delivery</h1>
      <p>
        DaloyJS already verifies <em>inbound</em> webhooks with{" "}
        <code>verifyWebhookSignature()</code> and signs payloads with{" "}
        <code>signWebhookPayload()</code>.{" "}
        <code>createWebhookSender()</code> closes the loop on the{" "}
        <em>outbound</em> side: it delivers events to your subscribers with a{" "}
        timestamped HMAC signature, bounded retries with exponential backoff,{" "}
        <code>Retry-After</code> awareness, a per-attempt timeout, and{" "}
        dead-letter semantics, all with{" "}
        <strong>zero runtime dependencies</strong> and SSRF-safe transport by
        default.
      </p>
      <ul>
        <li>
          <strong>Signed delivery</strong>: each request carries{" "}
          <code>webhook-id</code>, <code>webhook-timestamp</code>, and{" "}
          <code>webhook-signature</code> (<code>sha256=&hellip;</code>) computed
          over <code>&quot;&lt;timestamp&gt;.&lt;body&gt;&quot;</code>, the same
          convention <code>verifyWebhookSignature()</code> validates.
        </li>
        <li>
          <strong>Retry with backoff</strong>: transient statuses (
          <code>408/429/500/502/503/504</code>) and network errors are retried
          with exponential backoff + jitter, honouring <code>Retry-After</code>.
        </li>
        <li>
          <strong>Dead-letter</strong>: events that exhaust their
          attempts (or fail permanently) are handed to a{" "}
          <code>WebhookDeadLetterSink</code> for later inspection or replay.
        </li>
        <li>
          <strong>SSRF-safe by default</strong>: the transport defaults
          to <code>fetchGuard()</code>, so a subscriber URL pointing at cloud
          metadata or a private range is refused (and never retried).
        </li>
      </ul>

      <SequenceDiagram
        title="Delivery lifecycle"
        participants={["createWebhookSender()", "fetchGuard()", "Subscriber", "Dead-letter sink"]}
        steps={[
          {
            from: "createWebhookSender()",
            to: "Subscriber",
            kind: "request",
            label: "Signed POST (attempt 1)",
            detail: "webhook-id, webhook-timestamp, webhook-signature=sha256=...",
          },
          {
            from: "Subscriber",
            to: "createWebhookSender()",
            kind: "response",
            label: "503 + Retry-After (transient)",
            detail: "retryable status -> schedule a retry",
          },
          {
            from: "createWebhookSender()",
            to: "Subscriber",
            kind: "async",
            label: "Retry with backoff + jitter",
            detail: "same webhook-id/signature reused; honours Retry-After",
          },
          {
            from: "Subscriber",
            to: "createWebhookSender()",
            kind: "response",
            label: "2xx -> delivered",
            detail: "result.ok === true",
          },
          {
            from: "fetchGuard()",
            to: "Dead-letter sink",
            kind: "note",
            label: "SSRF refusal or attempts exhausted",
            detail: "SsrfBlockedError is permanent: never retried -> WebhookDeadLetterSink",
          },
        ]}
        caption="Each delivery is a signed POST. Transient failures are retried with exponential backoff and jitter while reusing the same signature. An SSRF refusal or an exhausted attempt budget is sent straight to the dead-letter sink for inspection or replay."
      />

      <h2>Quick start</h2>
      <CodeBlock
        language="ts"
        code={`import { createWebhookSender, MemoryWebhookDeadLetterSink } from "@daloyjs/core";

const deadLetter = new MemoryWebhookDeadLetterSink();

const send = createWebhookSender({
  secret: process.env.WEBHOOK_SIGNING_SECRET!,
  deadLetter,
});

const result = await send({
  url: subscriber.endpoint,
  eventType: "invoice.paid",
  payload: { id: invoice.id, amount: invoice.total },
});

if (!result.ok) {
  console.warn("delivery failed", result.attempts, result.status, result.error);
}`}
      />

      <h2>What the receiver sees</h2>
      <p>
        Every delivery is a <code>POST</code> with a stable idempotency id and a
        signature your subscriber verifies with the same shared secret:
      </p>
      <CodeBlock
        language="http"
        code={`POST /hooks HTTP/1.1
content-type: application/json
user-agent: DaloyJS-Webhook/1.0
webhook-id: 7c1c2d4e-...-9f
webhook-timestamp: 1700000000
webhook-signature: sha256=9f8a...c2

{"id":"in_1","amount":4200}`}
      />
      <p>
        The signature is computed once and reused across retries, so the{" "}
        <code>webhook-id</code> and <code>webhook-signature</code> are identical
        on every attempt, so receivers can safely dedupe on the id.
      </p>

      <h2>Verifying on the receiving end</h2>
      <p>
        A DaloyJS receiver verifies the delivery with the inbound helper, using
        the same secret and the <code>webhook-timestamp</code> header:
      </p>
      <CodeBlock
        language="ts"
        code={`import { verifyWebhookSignature } from "@daloyjs/core";

app.route({
  method: "POST",
  path: "/hooks",
  operationId: "receiveWebhook",
  responses: {
    200: { description: "ok" },
    401: { description: "invalid signature" },
  },
  handler: async ({ request }) => {
    const body = new Uint8Array(await request.arrayBuffer());
    const ok = await verifyWebhookSignature({
      payload: body,
      signature: request.headers.get("webhook-signature")!,
      secret: process.env.WEBHOOK_SIGNING_SECRET!,
      timestamp: Number(request.headers.get("webhook-timestamp")),
      toleranceSeconds: 300,
    });
    if (!ok) return { status: 401 as const, body: { error: "invalid signature" } };
    // ... handle the event
    return { status: 200 as const, body: { ok: true } };
  },
});`}
      />

      <h2>Retry &amp; backoff</h2>
      <p>
        Failed deliveries are retried up to <code>maxAttempts</code> (default{" "}
        <code>5</code>) with exponential backoff between{" "}
        <code>retryDelayMs</code> and <code>maxRetryDelayMs</code>. A{" "}
        <code>Retry-After</code> header on a <code>429</code>/<code>503</code>{" "}
        takes precedence (capped at <code>maxRetryDelayMs</code>). Only
        transient statuses and network/timeout errors are retried; a{" "}
        <code>400</code> or any other non-retryable status fails immediately.
      </p>
      <CodeBlock
        language="ts"
        code={`const send = createWebhookSender({
  secret,
  maxAttempts: 6,
  retryDelayMs: 250,
  maxRetryDelayMs: 60_000,
  backoffFactor: 2,
  jitter: true,
  timeoutMs: 10_000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  respectRetryAfter: true,
  onAttempt: (a) =>
    console.log("attempt", a.attempt, "status", a.status, "retry?", a.willRetry),
});`}
      />

      <h2>Dead-letter semantics</h2>
      <p>
        When an event exhausts its attempts, or fails permanently (a{" "}
        non-retryable status or an SSRF refusal), it is handed to the{" "}
        configured <code>WebhookDeadLetterSink</code>. The built-in{" "}
        <code>MemoryWebhookDeadLetterSink</code> is a bounded ring buffer; in
        production, implement the one-method interface to persist to your queue
        or table:
      </p>
      <CodeBlock
        language="ts"
        code={`import type { WebhookDeadLetter, WebhookDeadLetterSink } from "@daloyjs/core";

class TableDeadLetterSink implements WebhookDeadLetterSink {
  async add(letter: WebhookDeadLetter): Promise<void> {
    await db.deadLetters.insert({
      id: letter.id,
      url: letter.url,
      eventType: letter.eventType,
      body: Buffer.from(letter.payload),
      contentType: letter.contentType,
      attempts: letter.attempts,
      lastStatus: letter.lastStatus,
      lastError: letter.lastError,
      failedAt: new Date(letter.failedAt),
    });
  }
}`}
      />
      <p>
        The stored <code>payload</code> and <code>timestamp</code> are exactly
        what was signed, so a dead-lettered event can be re-delivered later
        without re-signing under a new timestamp.
      </p>

      <h2>SSRF posture</h2>
      <p>
        The transport defaults to <code>fetchGuard()</code>. A subscriber URL
        that resolves to a cloud-metadata address or a private range is refused
        with an <code>SsrfBlockedError</code>, which the sender treats as a{" "}
        <em>permanent</em> failure: it is never retried and goes straight to the
        dead-letter sink. To use a custom transport (for example, a{" "}
        <code>resilientFetch()</code> wrapping <code>fetchGuard()</code>), pass{" "}
        <code>fetch</code> explicitly, but never default it to the bare{" "}
        global <code>fetch</code> for subscriber-controlled URLs.
      </p>
    </>
  );
}
