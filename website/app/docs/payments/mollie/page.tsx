import Link from "next/link";
import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Accept payments with Mollie in DaloyJS",
  description:
    "Integrate the official mollie-api-typescript SDK with a DaloyJS API. Covers the Client constructor, payments.create with idempotency keys, the new SignatureValidator for X-Mollie-Signature webhooks, async-iterable pagination, and edge-runtime support.",
  path: "/docs/payments/mollie",
  keywords: [
    "DaloyJS Mollie",
    "mollie-api-typescript",
    "SignatureValidator",
    "X-Mollie-Signature",
    "Mollie webhook HMAC",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Accept payments with Mollie in DaloyJS</h1>
      <p>
        <a href="https://www.mollie.com/" target="_blank" rel="noreferrer">
          Mollie
        </a>{" "}
        is the dominant European payment platform, strong on iDEAL, Bancontact, SEPA, Klarna,
        and a deep catalogue of local methods alongside cards and wallets. This guide uses
        the official{" "}
        <a
          href="https://github.com/mollie/mollie-api-typescript"
          target="_blank"
          rel="noreferrer"
        >
          <code>mollie-api-typescript</code>
        </a>{" "}
        SDK (v1.8.x, released May 2026) from a DaloyJS server, with the new{" "}
        <code>SignatureValidator</code> helper for signed webhooks.
      </p>

      <h2>What you should know up front</h2>
      <ul>
        <li>
          <strong>Right package, please.</strong> The new SDK is{" "}
          <code>mollie-api-typescript</code> (Speakeasy-generated, Fetch-based,
          tree-shakable, edge-runtime friendly). The older{" "}
          <code>@mollie/api-client</code> still works but is the previous generation, new
          projects should use the TypeScript-first one.
        </li>
        <li>
          <strong>It&apos;s a redirect flow.</strong> You create a payment, Mollie returns a{" "}
          <code>_links.checkout.href</code>, you redirect the customer there. They come back
          to your <code>redirectUrl</code> (browser) and your <code>webhookUrl</code> gets
          POSTed (server). The redirect is a UX signal only, the webhook is the source of
          truth.
        </li>
        <li>
          <strong>Webhooks are signed now.</strong> Mollie sends{" "}
          <code>X-Mollie-Signature: sha256=...</code> on signed endpoints. Verify with{" "}
          <code>SignatureValidator</code>; treat &quot;no signature header&quot; as a legacy
          webhook (older subscriptions don&apos;t sign).
        </li>
        <li>
          <strong>Amounts are decimal strings.</strong> Unlike most providers, Mollie wants{" "}
          <code>{`{ currency: "EUR", value: "10.00" }`}</code>: a string with exactly two
          decimals for EUR. Pass <code>1000</code> as a number and you&apos;ll get a 422.
        </li>
        <li>
          <strong>Test vs live is the API key.</strong> Keys are prefixed{" "}
          <code>test_</code> or <code>live_</code>; there&apos;s no separate environment
          flag for normal API-key auth. <code>testmode: true</code> is only needed for
          organisation-level OAuth tokens.
        </li>
      </ul>

      <h2>1. Provision</h2>
      <ol>
        <li>
          Sign up at{" "}
          <a href="https://my.mollie.com/" target="_blank" rel="noreferrer">
            my.mollie.com
          </a>{" "}
          and create a profile.
        </li>
        <li>
          Generate a <strong>test API key</strong> (Dashboard → Developers → API keys). It
          starts with <code>test_</code>.
        </li>
        <li>
          In Developers → Webhooks, create a webhook subscription pointing at your DaloyJS
          endpoint. Save the <strong>signing secret</strong>: you&apos;ll only see it once.
        </li>
        <li>
          Enable the payment methods you want under Settings → Website profile → Payment
          methods. iDEAL and Bancontact need explicit activation.
        </li>
      </ol>

      <h2>2. Install</h2>
      <CodeBlock code={`pnpm add mollie-api-typescript`} />

      <h2>3. Environment variables</h2>
      <CodeBlock
        code={`# .env
MOLLIE_API_KEY=test_replace_me              # or live_...
MOLLIE_WEBHOOK_SECRET=whsec_replace_me      # from Developers \u2192 Webhooks
APP_URL=https://your-app.example.com`}
      />

      <h2>4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/mollie.ts
import { Client, SignatureValidator, InvalidSignatureException } from "mollie-api-typescript";
import type { App } from "@daloyjs/core";

const mollie = new Client({
  security: { apiKey: process.env.MOLLIE_API_KEY! },
});

const validator = new SignatureValidator(process.env.MOLLIE_WEBHOOK_SECRET!);

export interface MollieClient {
  raw: Client;
  createPayment(input: {
    amount: { currency: string; value: string };  // value is a string!
    description: string;
    redirectUrl: string;
    method?: string[];                            // e.g. ["ideal", "creditcard"]
    metadata?: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ id: string; checkoutUrl: string; status: string }>;

  getPayment(id: string): Promise<{ id: string; status: string; amount: { currency: string; value: string } }>;

  verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<"valid" | "legacy" | "invalid">;
}

export const molliePlugin = {
  name: "mollie",
  register(app: App) {
    const client: MollieClient = {
      raw: mollie,

      async createPayment({ amount, description, redirectUrl, method, metadata, idempotencyKey }) {
        const res = await mollie.payments.create({
          idempotencyKey,
          paymentRequest: {
            amount,
            description,
            redirectUrl,
            webhookUrl: \`\${process.env.APP_URL}/webhooks/mollie\`,
            ...(method ? { method } : {}),
            ...(metadata ? { metadata } : {}),
          },
        });
        return {
          id: res.id!,
          status: res.status!,
          checkoutUrl: res.links?.checkout?.href ?? "",
        };
      },

      async getPayment(id) {
        const res = await mollie.payments.get({ paymentId: id });
        return {
          id: res.id!,
          status: res.status!,
          amount: res.amount!,
        };
      },

      async verifyWebhook(rawBody, signatureHeader) {
        try {
          const verified = await validator.validatePayload(rawBody, signatureHeader ?? undefined);
          return verified ? "valid" : "legacy";
        } catch (error) {
          if (error instanceof InvalidSignatureException) return "invalid";
          throw error;
        }
      },
    };

    app.decorate("mollie", client);
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    mollie: MollieClient;
  }
}`}
      />
      <p>
        <code>SignatureValidator</code> uses HMAC-SHA256 over the raw request body. The{" "}
        <em>raw</em> body is non-negotiable, re-serialising parsed JSON will reorder fields
        and break the signature.
      </p>

      <h2>5. Create a payment</h2>
      <SequenceDiagram
        title="Redirect payment flow"
        participants={["Shopper", "DaloyJS route", "Mollie"]}
        steps={[
          {
            from: "Shopper",
            to: "DaloyJS route",
            label: "POST /checkout/mollie",
            detail: "orderId + amount { value: '10.00' }",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "Mollie",
            label: "payments.create with an idempotencyKey",
            detail: "redirectUrl + webhookUrl",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "Shopper",
            label: "Return _links.checkout.href",
            detail: "201 { checkoutUrl }",
            kind: "response",
          },
          {
            from: "Shopper",
            to: "Mollie",
            label: "Pays on the hosted checkout, returns via redirectUrl",
            detail: "redirect is a UX hint, not proof",
            kind: "async",
          },
        ]}
        caption="Create the payment with an idempotency key, hand the shopper the hosted checkout URL, and treat the redirect back as a UX signal only. The webhook is the source of truth."
      />
      <CodeBlock
        code={`import { z } from "zod";
import { randomUUID } from "node:crypto";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { molliePlugin } from "./plugins/mollie";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 30 }));
app.register(molliePlugin);

app.route({
  method: "POST",
  path: "/checkout/mollie",
  operationId: "createMolliePayment",
  request: {
    body: z.object({
      orderId: z.string().min(1).max(80),
      amount: z.object({
        currency: z.string().length(3),
        value: z.string().regex(/^\\d+\\.\\d{2}$/),  // "10.00"
      }),
      description: z.string().min(1).max(255),
      method: z.array(z.string()).optional(),
    }),
  },
  responses: {
    201: {
      description: "payment created",
      body: z.object({
        paymentId: z.string(),
        checkoutUrl: z.string().url(),
      }),
    },
  },
  handler: async ({ body, state }) => {
    const payment = await state.mollie.createPayment({
      amount: body.amount,
      description: body.description,
      redirectUrl: \`\${process.env.APP_URL}/checkout/return?order=\${encodeURIComponent(body.orderId)}\`,
      method: body.method,
      metadata: { orderId: body.orderId },
      idempotencyKey: \`order:\${body.orderId}:\${randomUUID()}\`,
    });
    return {
      status: 201,
      body: { paymentId: payment.id, checkoutUrl: payment.checkoutUrl },
    };
  },
});`}
      />

      <h2>6. Webhook</h2>
      <SequenceDiagram
        title="Webhook verification"
        participants={["Mollie", "DaloyJS route"]}
        steps={[
          {
            from: "Mollie",
            to: "DaloyJS route",
            label: "POST /webhooks/mollie",
            detail: "X-Mollie-Signature: sha256=... over id=tr_xxx",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "SignatureValidator over the raw body",
            detail: "valid | legacy (unsigned) | invalid",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "Mollie",
            label: "401 on invalid, otherwise payments.get(id)",
            detail: "refetch the authoritative status",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "Mollie",
            label: "Fulfil when status === 'paid', ack 200",
            detail: "use metadata.orderId",
            kind: "async",
          },
        ]}
        caption="Verify X-Mollie-Signature over the raw body, refetch the full payment with payments.get because the webhook body carries only the id, then fulfil on the 'paid' status and ack 200 fast."
      />
      <p>
        Mollie&apos;s webhook payload is famously minimalist: a form-encoded body of{" "}
        <code>id=tr_xxx</code>. You take that <code>id</code>, fetch the full payment from
        the API, and react to its current status. Always 200 OK quickly, even on
        not-interesting events, Mollie retries non-200 responses.
      </p>
      <CodeBlock
        code={`import { readRawBody } from "@daloyjs/core/raw";

app.route({
  method: "POST",
  path: "/webhooks/mollie",
  operationId: "mollieWebhook",
  responses: {
    200: { description: "ok", body: z.object({ ok: z.literal(true) }) },
    401: { description: "bad signature", body: z.object({ error: z.string() }) },
  },
  handler: async ({ request, state }) => {
    const raw = await readRawBody(request);
    const signature = request.headers.get("x-mollie-signature");

    const status = await state.mollie.verifyWebhook(raw, signature);
    if (status === "invalid") {
      return { status: 401, body: { error: "bad signature" } };
    }
    // "legacy" = unsigned (old subscription). Decide if you want to accept these.
    // In production with a fresh subscription, require "valid".

    const params = new URLSearchParams(raw);
    const paymentId = params.get("id");
    if (!paymentId) return { status: 200, body: { ok: true as const } };

    const payment = await state.mollie.getPayment(paymentId);

    // payment.status \u2208 "open" | "pending" | "authorized" | "paid" | "expired" | "failed" | "canceled"
    if (payment.status === "paid") {
      // Fulfil the order. Use the metadata.orderId set at creation.
    }

    return { status: 200, body: { ok: true as const } };
  },
});`}
      />

      <h2>7. Refunds, captures, and cancellation</h2>
      <CodeBlock
        code={`// Full refund
await state.mollie.raw.refunds.create({
  paymentId: "tr_xxx",
  refundRequest: {
    amount: { currency: "EUR", value: "10.00" },
    description: "Customer request",
  },
});

// Capture a previously authorized card payment (when capture mode = manual)
await state.mollie.raw.captures.create({
  paymentId: "tr_xxx",
  captureRequest: {
    amount: { currency: "EUR", value: "10.00" },
  },
});

// Cancel an open payment
await state.mollie.raw.payments.cancel({ paymentId: "tr_xxx" });`}
      />

      <h2>Pagination</h2>
      <p>
        List endpoints return async iterables, let <code>for await</code> walk the pages for
        you:
      </p>
      <CodeBlock
        code={`const pages = await state.mollie.raw.payments.list({ limit: 50 });
for await (const page of pages) {
  for (const payment of page.embedded?.payments ?? []) {
    // ...
  }
}`}
      />

      <h2>Runtimes</h2>
      <p>
        The SDK is built on the Fetch API and ships ESM + CJS, so it runs on Node 18+,
        Cloudflare Workers, Vercel Edge, Bun, and Deno without adapters. The webhook
        verifier is pure crypto using <code>crypto.subtle.importKey</code> /{" "}
        <code>sign</code> under the hood and works in every modern runtime.
      </p>

      <h2>Errors</h2>
      <p>
        Mollie returns RFC-7807-shaped problem details. Catch <code>errors.ErrorResponse</code>{" "}
        and map it through <Link href="/docs/errors">problem+json</Link>:
      </p>
      <CodeBlock
        code={`import * as errors from "mollie-api-typescript/models/errors";

try {
  await state.mollie.createPayment(/* ... */);
} catch (e) {
  if (e instanceof errors.ErrorResponse) {
    // e.data$.status, e.data$.title, e.data$.detail, e.data$.field
    throw new HttpError(e.data$.status, "https://mollie.com/errors", e.data$.title, e.data$.detail);
  }
  throw e;
}`}
      />

      <h2>Modernisation notes</h2>
      <ul>
        <li>
          <strong>Use the TypeScript SDK over the JS client.</strong>{" "}
          <code>mollie-api-typescript</code> ships first-class types, tree-shakable standalone
          functions, async-iterable pagination, and a Fetch-based HTTP client that runs at
          the edge. The older <code>@mollie/api-client</code> is fine for legacy code but no
          longer the recommended starting point.
        </li>
        <li>
          <strong>Verify signatures.</strong> Mollie added signed webhooks specifically so
          you don&apos;t have to rely on &quot;refetch the payment and hope IP allow-lists
          are right&quot;. Use <code>SignatureValidator</code> with the raw body.
        </li>
        <li>
          <strong>Idempotency keys on every create.</strong> The SDK accepts{" "}
          <code>idempotencyKey</code> alongside the request body, pass one derived from your
          order id so a network retry doesn&apos;t spawn duplicate payments.
        </li>
        <li>
          <strong>Don&apos;t trust the redirect.</strong> The <code>redirectUrl</code> only
          tells you the user came back, they could close the tab mid-iDEAL. The webhook +
          a follow-up <code>payments.get</code> is what flips an order to paid.
        </li>
      </ul>

      <p>
        See also the <Link href={"/docs/payments" as Route}>payments overview</Link>,{" "}
        <Link href={"/docs/payments/adyen" as Route}>Adyen guide</Link>,{" "}
        <Link href={"/docs/payments/braintree" as Route}>Braintree guide</Link>, and{" "}
        <Link href="/docs/errors">problem+json errors</Link>.
      </p>
    </>
  );
}
