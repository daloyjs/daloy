import Link from "next/link";
import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Accept payments with Razorpay in DaloyJS",
  description:
    "Integrate Razorpay (UPI, cards, netbanking, wallets) from a DaloyJS API using the official razorpay Node SDK. Covers the Orders flow, validatePaymentVerification for the client return, validateWebhookSignature with the raw body, refunds, and edge-runtime caveats.",
  path: "/docs/payments/razorpay",
  keywords: [
    "DaloyJS Razorpay",
    "razorpay node",
    "Razorpay Orders API",
    "validatePaymentVerification",
    "validateWebhookSignature",
    "Razorpay webhook HMAC",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Accept payments with Razorpay in DaloyJS</h1>
      <p>
        <a href="https://razorpay.com/" target="_blank" rel="noreferrer">
          Razorpay
        </a>{" "}
        is the default payment stack for India, <strong>UPI</strong>, cards, netbanking,
        wallets, EMI, and BNPL through one API. This guide uses the official{" "}
        <a
          href="https://github.com/razorpay/razorpay-node"
          target="_blank"
          rel="noreferrer"
        >
          <code>razorpay</code>
        </a>{" "}
        Node SDK with the Orders flow, the SDK&apos;s built-in{" "}
        <code>validatePaymentVerification</code> for the post-checkout callback, and{" "}
        <code>validateWebhookSignature</code> for IPN.
      </p>

      <h2>What you should know up front</h2>
      <ul>
        <li>
          <strong>Two signatures, not one.</strong> Razorpay signs two different things:
          (1) the client-side checkout result, verify with{" "}
          <code>validatePaymentVerification</code> using your <em>key secret</em>; (2) the
          server-side webhook, verify with <code>validateWebhookSignature</code> using
          your <em>webhook secret</em>. They&apos;re different secrets and different
          payloads.
        </li>
        <li>
          <strong>Orders are the source of truth, not raw payments.</strong> Create an
          Order on your server, hand <code>order_id</code> to Checkout, then verify the
          callback. Skipping the Order step is technically allowed but loses you idempotency,
          reconciliation, and the &quot;late authorisation&quot; protection.
        </li>
        <li>
          <strong>Amounts are paise.</strong> ₹500.00 →{" "}
          <code>{`{ amount: 50000, currency: "INR" }`}</code>. Don&apos;t pass floats, the
          API rejects them.
        </li>
        <li>
          <strong>Webhook verification needs the raw body.</strong>{" "}
          <code>JSON.parse</code> + <code>JSON.stringify</code> changes byte order, which
          breaks the HMAC. Read the request body as a string before parsing it.
        </li>
        <li>
          <strong>Don&apos;t roll your own HMAC.</strong> The SDK exposes both verifiers as
          plain helpers; using them keeps you aligned when Razorpay tweaks the algorithm or
          adds new fields.
        </li>
      </ul>

      <h2>1. Provision</h2>
      <ol>
        <li>
          Sign in to the{" "}
          <a href="https://dashboard.razorpay.com/" target="_blank" rel="noreferrer">
            Razorpay dashboard
          </a>
          .
        </li>
        <li>
          Account &amp; Settings → API Keys → Generate Test Key. Save the{" "}
          <code>key_id</code> and <code>key_secret</code>: the secret is shown once.
        </li>
        <li>
          Account &amp; Settings → Webhooks → Add new. Point it at your DaloyJS endpoint and
          set a <strong>webhook secret</strong>. Subscribe to at least{" "}
          <code>payment.captured</code>, <code>payment.failed</code>,{" "}
          <code>order.paid</code>, and <code>refund.processed</code>.
        </li>
        <li>
          Activate the methods you need (UPI/cards are on by default; netbanking and
          wallets typically need explicit enabling).
        </li>
      </ol>

      <h2>2. Install</h2>
      <CodeBlock code={`pnpm add razorpay`} />

      <h2>3. Environment variables</h2>
      <CodeBlock
        code={`# .env
RAZORPAY_KEY_ID=rzp_test_replace_me            # public-ish, used by Checkout JS too
RAZORPAY_KEY_SECRET=replace_me                 # secret; verifies client callback
RAZORPAY_WEBHOOK_SECRET=replace_me             # webhook secret; verifies IPN
APP_URL=https://your-app.example.com`}
      />

      <h2>4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/razorpay.ts
import Razorpay from "razorpay";
import { validatePaymentVerification, validateWebhookSignature } from "razorpay/dist/utils/razorpay-utils";
import type { App } from "@daloyjs/core";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export interface RazorpayClient {
  raw: Razorpay;

  createOrder(input: {
    amount: number;              // paise
    currency?: string;           // default "INR"
    receipt: string;             // your internal order id; max 40 chars
    notes?: Record<string, string>;
    paymentCapture?: boolean;    // default true (auto-capture on successful payment)
  }): Promise<{ id: string; amount: number; currency: string; receipt: string; status: string }>;

  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;

  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;

  fetchPayment(paymentId: string): Promise<{ id: string; status: string; amount: number; currency: string; order_id?: string; method?: string }>;

  refund(input: {
    paymentId: string;
    amount?: number;             // omit for full refund
    notes?: Record<string, string>;
    speed?: "normal" | "optimum";
  }): Promise<{ id: string; status: string; amount: number }>;
}

export const razorpayPlugin = {
  name: "razorpay",
  register(app: App) {
    const client: RazorpayClient = {
      raw: razorpay,

      async createOrder({ amount, currency = "INR", receipt, notes, paymentCapture = true }) {
        const order = await razorpay.orders.create({
          amount,
          currency,
          receipt,
          notes,
          payment_capture: paymentCapture,
        });
        return {
          id: order.id,
          amount: Number(order.amount),
          currency: order.currency,
          receipt: order.receipt ?? receipt,
          status: order.status,
        };
      },

      verifyCheckoutSignature({ orderId, paymentId, signature }) {
        return validatePaymentVerification(
          { order_id: orderId, payment_id: paymentId },
          signature,
          process.env.RAZORPAY_KEY_SECRET!,
        );
      },

      verifyWebhookSignature(rawBody, signatureHeader) {
        if (!signatureHeader) return false;
        return validateWebhookSignature(rawBody, signatureHeader, process.env.RAZORPAY_WEBHOOK_SECRET!);
      },

      async fetchPayment(paymentId) {
        const p = await razorpay.payments.fetch(paymentId);
        return {
          id: p.id,
          status: p.status,
          amount: Number(p.amount),
          currency: p.currency,
          order_id: p.order_id,
          method: p.method,
        };
      },

      async refund({ paymentId, amount, notes, speed = "normal" }) {
        const refund = await razorpay.payments.refund(paymentId, {
          ...(amount !== undefined ? { amount } : {}),
          ...(notes ? { notes } : {}),
          speed,
        });
        return { id: refund.id, status: refund.status, amount: Number(refund.amount) };
      },
    };

    app.decorate("razorpay", client);
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    razorpay: RazorpayClient;
  }
}`}
      />
      <p>
        The verifier helpers live at <code>razorpay/dist/utils/razorpay-utils</code> in the
        published bundle, Razorpay&apos;s own README points there. They&apos;re plain
        functions over <code>node:crypto</code>; no SDK instance needed.
      </p>

      <h2>5. Create an order</h2>
      <p>
        The frontend uses{" "}
        <a
          href="https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/"
          target="_blank"
          rel="noreferrer"
        >
          Razorpay Checkout JS
        </a>{" "}
        with the <code>orderId</code> from this endpoint plus your public{" "}
        <code>key_id</code>.
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { razorpayPlugin } from "./plugins/razorpay";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 30 }));
app.register(razorpayPlugin);

app.route({
  method: "POST",
  path: "/checkout/razorpay/order",
  operationId: "createRazorpayOrder",
  request: {
    body: z.object({
      orderId: z.string().min(1).max(40),               // becomes "receipt"
      amount: z.number().int().positive(),              // paise
      currency: z.string().length(3).default("INR"),
      notes: z.record(z.string(), z.string()).optional(),
    }),
  },
  responses: {
    201: {
      description: "order created",
      body: z.object({
        orderId: z.string(),
        amount: z.number(),
        currency: z.string(),
        keyId: z.string(),
      }),
    },
  },
  handler: async ({ body, state }) => {
    const order = await state.razorpay.createOrder({
      amount: body.amount,
      currency: body.currency,
      receipt: body.orderId,
      notes: body.notes,
    });
    return {
      status: 201,
      body: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID!,
      },
    };
  },
});`}
      />

      <h2>6. Verify the client callback</h2>
      <SequenceDiagram
        title="Order + client callback verification"
        participants={["Browser", "DaloyJS route", "Razorpay"]}
        steps={[
          {
            from: "Browser",
            to: "DaloyJS route",
            label: "POST /checkout/razorpay/order",
            detail: "amount in paise + receipt",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "Razorpay",
            label: "orders.create, return order_id + key_id",
            detail: "Checkout JS opens with order_id",
            kind: "request",
          },
          {
            from: "Browser",
            to: "DaloyJS route",
            label: "POST /verify after Checkout success",
            detail: "razorpay_order_id, _payment_id, _signature",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "validatePaymentVerification with the key secret",
            detail: "401 on mismatch, then fetchPayment",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "Browser",
            label: "200 only when payment.status is 'captured'",
            detail: "signature proves origin, not capture",
            kind: "response",
          },
        ]}
        caption="Create the Order server-side, verify the client callback signature with your key secret, then refetch the payment because the signature proves the callback came from Razorpay but not that it was captured."
      />
      <p>
        After a successful payment, Checkout JS posts{" "}
        <code>{`{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`}</code> back
        to your client. Forward to the server and verify before doing anything:
      </p>
      <CodeBlock
        code={`app.route({
  method: "POST",
  path: "/checkout/razorpay/verify",
  operationId: "verifyRazorpayCheckout",
  request: {
    body: z.object({
      razorpay_order_id: z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature: z.string(),
    }),
  },
  responses: {
    200: { description: "verified", body: z.object({ status: z.literal("captured") }) },
    401: { description: "bad signature", body: z.object({ error: z.string() }) },
  },
  handler: async ({ body, state }) => {
    const valid = state.razorpay.verifyCheckoutSignature({
      orderId: body.razorpay_order_id,
      paymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature,
    });
    if (!valid) {
      return { status: 401, body: { error: "signature mismatch" } };
    }

    // The signature only proves the callback came from Razorpay \u2014 it doesn't
    // confirm capture. Fetch the payment to read authoritative status.
    const payment = await state.razorpay.fetchPayment(body.razorpay_payment_id);
    if (payment.status !== "captured") {
      return { status: 401, body: { error: \`payment not captured: \${payment.status}\` } };
    }

    return { status: 200, body: { status: "captured" as const } };
  },
});`}
      />

      <h2>7. Webhook</h2>
      <SequenceDiagram
        title="Webhook verification"
        participants={["Razorpay", "DaloyJS route", "Your queue"]}
        steps={[
          {
            from: "Razorpay",
            to: "DaloyJS route",
            label: "POST /webhooks/razorpay",
            detail: "X-Razorpay-Signature over raw body",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "validateWebhookSignature with the webhook secret",
            detail: "different secret from the client callback",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "Razorpay",
            label: "401 when the signature does not match",
            detail: "{ error: 'bad signature' }",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "Your queue",
            label: "Handle payment.captured / refund.processed, then ack",
            detail: "200 even for unhandled events",
            kind: "async",
          },
        ]}
        caption="The webhook uses a different secret than the client callback. Verify X-Razorpay-Signature over the raw body with the webhook secret, then ack 200 for every event once it checks out, even ones you do not handle."
      />
      <CodeBlock
        code={`import { readRawBody } from "@daloyjs/core/raw";

app.route({
  method: "POST",
  path: "/webhooks/razorpay",
  operationId: "razorpayWebhook",
  responses: {
    200: { description: "ok", body: z.object({ ok: z.literal(true) }) },
    401: { description: "bad signature", body: z.object({ error: z.string() }) },
  },
  handler: async ({ request, state }) => {
    const raw = await readRawBody(request);
    const signature = request.headers.get("x-razorpay-signature");

    if (!state.razorpay.verifyWebhookSignature(raw, signature)) {
      return { status: 401, body: { error: "bad signature" } };
    }

    const event = JSON.parse(raw) as {
      event: string;
      payload: { payment?: { entity: { id: string; order_id?: string; status: string } } };
    };

    switch (event.event) {
      case "payment.captured": {
        const payment = event.payload.payment?.entity;
        if (payment) {
          // Fulfil. Idempotency key = (payment.order_id, payment.id).
        }
        break;
      }
      case "payment.failed":
        // Notify, log, surface to customer.
        break;
      case "refund.processed":
        // Mark refund complete in your ledger.
        break;
    }

    return { status: 200, body: { ok: true as const } };
  },
});`}
      />
      <p>
        Always return 200 once the signature checks out, even for events you don&apos;t
        handle. Razorpay retries non-2xx responses with exponential backoff for up to 24
        hours.
      </p>

      <h2>8. Refunds</h2>
      <CodeBlock
        code={`// Full refund \u2014 omit amount.
await state.razorpay.refund({ paymentId: "pay_xxx" });

// Partial refund.
await state.razorpay.refund({
  paymentId: "pay_xxx",
  amount: 10000,                  // \u20b9100.00 in paise
  notes: { reason: "Item missing" },
  speed: "optimum",               // attempts instant refund where supported
});`}
      />

      <h2>Runtimes</h2>
      <p>
        The <code>razorpay</code> SDK ships CJS and depends on Node&apos;s{" "}
        <code>https</code> module, it runs on Node 18+ but is not edge-runtime compatible.
        For Cloudflare Workers or Vercel Edge, hit{" "}
        <code>https://api.razorpay.com/v1</code> directly with <code>fetch</code> and Basic
        auth (<code>Authorization: Basic base64(key_id:key_secret)</code>). The two
        signature helpers are pure HMAC and easy to reimplement with{" "}
        <code>crypto.subtle</code> if you don&apos;t want the bundled ones.
      </p>

      <h2>Errors</h2>
      <p>
        Razorpay throws errors with a structured <code>error.error</code> object containing{" "}
        <code>code</code>, <code>description</code>, <code>field</code>, and{" "}
        <code>reason</code>. Map them through{" "}
        <Link href="/docs/errors">problem+json</Link> with the Razorpay <code>code</code> on
        the <code>type</code> field so reconciliation tools can match them later.
      </p>

      <h2>Modernisation notes</h2>
      <ul>
        <li>
          <strong>Use Orders, not bare payment links.</strong> The Orders flow gives you a
          server-side anchor for idempotency, lets Checkout JS show the right amount, and
          unlocks <code>order.paid</code> webhooks that fire even when the customer closes
          the tab before the success callback.
        </li>
        <li>
          <strong>Verify both signatures.</strong> The client callback signature stops
          forged success posts from the browser; the webhook signature stops spoofed IPNs.
          Skipping either is a foot-gun.
        </li>
        <li>
          <strong>Don&apos;t fulfil on the client callback alone.</strong> The signature
          proves the call came from Razorpay, but <code>status: created</code> isn&apos;t{" "}
          <code>captured</code>. Always re-fetch the payment (or wait for the webhook)
          before flipping an order to paid.
        </li>
        <li>
          <strong>Use Promises, ignore the callback API.</strong> Every method on the SDK
          returns a Promise. The error-first callback parameter still works but exists for
          legacy code only.
        </li>
      </ul>

      <p>
        See also the <Link href={"/docs/payments" as Route}>payments overview</Link>,{" "}
        <Link href={"/docs/payments/tap" as Route}>Tap Payments guide</Link>,{" "}
        <Link href={"/docs/payments/paytabs" as Route}>PayTabs guide</Link>, and{" "}
        <Link href="/docs/errors">problem+json errors</Link>.
      </p>
    </>
  );
}
