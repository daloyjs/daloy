import Link from "next/link";
import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Accept payments with Stripe in DaloyJS",
  description:
    "Integrate Stripe Checkout from a DaloyJS API using the official stripe Node SDK and @stripe/stripe-js. Covers Stripe CLI setup, Checkout Sessions, webhook signature verification with the raw body, idempotency keys, refunds, and runtime caveats.",
  path: "/docs/payments/stripe",
  keywords: [
    "DaloyJS Stripe",
    "stripe node sdk",
    "Stripe Checkout Sessions",
    "Stripe webhook constructEvent",
    "@stripe/stripe-js",
    "Stripe idempotency key",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Accept payments with Stripe in DaloyJS</h1>
      <p>
        <a href="https://stripe.com/" target="_blank" rel="noreferrer">
          Stripe
        </a>{" "}
        is one of the most common starting points for SaaS, subscriptions,
        marketplaces, and card payments. This guide uses the official{" "}
        <a
          href="https://github.com/stripe/stripe-node"
          target="_blank"
          rel="noreferrer"
        >
          <code>stripe</code>
        </a>{" "}
        Node SDK on the server,{" "}
        <a
          href="https://www.npmjs.com/package/@stripe/stripe-js"
          target="_blank"
          rel="noreferrer"
        >
          <code>@stripe/stripe-js</code>
        </a>{" "}
        in the browser, and Stripe-hosted Checkout Sessions so card details
        never touch your DaloyJS app.
      </p>

      <h2 id="what-you-should-know-up-front">What you should know up front</h2>
      <ul>
        <li>
          <strong>Start with Checkout Sessions.</strong>{" "}
          <a
            href="https://docs.stripe.com/checkout/quickstart"
            target="_blank"
            rel="noreferrer"
          >
            Stripe Checkout
          </a>{" "}
          is the fastest secure path: your server creates a session, the browser
          redirects to Stripe, and Stripe handles the hosted payment page,
          payment method collection, SCA, wallets, localization, and receipts.
        </li>
        <li>
          <strong>Use Stripe.js on the client, not raw card forms.</strong>{" "}
          <code>@stripe/stripe-js</code> is a small loader for Stripe&apos;s
          hosted <code>https://js.stripe.com</code> script. Stripe says this is
          required for PCI compliance; do not bundle or self-host Stripe.js.
        </li>
        <li>
          <strong>Webhook verification needs the raw body.</strong>{" "}
          <code>stripe.webhooks.constructEvent()</code> requires the exact raw
          request body, the <code>Stripe-Signature</code> header, and the
          endpoint secret. JSON parsing before verification will break the
          signature check.
        </li>
        <li>
          <strong>Send idempotency keys on mutating retries.</strong> Stripe
          accepts idempotency keys on every <code>POST</code>
          {". "}Generate a UUID per logical attempt and reuse it when retrying
          the same create or update call.
        </li>
        <li>
          <strong>Stripe is separate from PayPal.</strong> Keep this guide next
          to <Link href={"/docs/payments/braintree" as Route}>Braintree</Link>
          {", "}
          not under it. Braintree is PayPal&apos;s gateway; Stripe is a separate
          provider.
        </li>
      </ul>

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Create a Stripe account or sandbox from the{" "}
          <a
            href="https://dashboard.stripe.com/register"
            target="_blank"
            rel="noreferrer"
          >
            Stripe Dashboard</a>
          {"."}
        </li>
        <li>
          Install and authenticate the{" "}
          <a
            href="https://docs.stripe.com/get-started/development-environment?lang=node"
            target="_blank"
            rel="noreferrer"
          >
            Stripe CLI
          </a>{" "}
          so you can create test products, forward webhooks, and run local
          integration checks.
        </li>
        <li>
          Copy your test <strong>Secret key</strong> and{" "}
          <strong>Publishable key</strong> from Developers - API keys. Keep the
          secret key server-side only.
        </li>
        <li>
          Add a webhook endpoint for your app and copy its{" "}
          <strong>Signing secret</strong>
          {", "}which starts with <code>whsec_</code>
          {". "}For local development, <code>stripe listen</code> prints a
          different secret than the Dashboard endpoint.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add stripe @stripe/stripe-js`} />
      <p>
        <code>stripe</code> belongs in your server application.{" "}
        <code>@stripe/stripe-js</code> belongs in browser code that redirects to
        Checkout or renders Elements. Neither package is a runtime dependency of
        <code>@daloyjs/core</code>.
      </p>

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_PUBLISHABLE_KEY=pk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
STRIPE_SUCCESS_URL=https://your-app.example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}
STRIPE_CANCEL_URL=https://your-app.example.com/cart
STRIPE_CURRENCY=usd`}
      />
      <p>
        Only <code>STRIPE_PUBLISHABLE_KEY</code> is safe to expose to the
        browser. Treat <code>sk_</code> keys and <code>whsec_</code> webhook
        secrets as production credentials.
      </p>

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/stripe.ts
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { App } from "@daloyjs/core";

let client: Stripe | null = null;

function getStripe() {
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
  return client;
}

export interface StripeClient {
  raw: Stripe;
  createCheckoutSession(input: {
    lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
    successUrl?: string;
    cancelUrl?: string;
    customerEmail?: string;
    clientReferenceId?: string;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<{ id: string; url: string }>;
  retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session>;
  refund(input: {
    paymentIntent: string;
    amount?: number;
    idempotencyKey?: string;
  }): Promise<{ id: string; status: string | null }>;
  constructWebhookEvent(rawBody: Buffer | string, signature: string | null): Stripe.Event;
}

export const stripePlugin = {
  name: "stripe",
  register(app: App) {
    const stripe = getStripe();
    const wrapped: StripeClient = {
      raw: stripe,

      async createCheckoutSession({
        lineItems,
        successUrl = process.env.STRIPE_SUCCESS_URL!,
        cancelUrl = process.env.STRIPE_CANCEL_URL!,
        customerEmail,
        clientReferenceId,
        metadata,
        idempotencyKey = randomUUID(),
      }) {
        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: lineItems,
            success_url: successUrl,
            cancel_url: cancelUrl,
            customer_email: customerEmail,
            client_reference_id: clientReferenceId,
            metadata,
          },
          { idempotencyKey },
        );

        if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");
        return { id: session.id, url: session.url };
      },

      retrieveCheckoutSession(sessionId) {
        return stripe.checkout.sessions.retrieve(sessionId, {
          expand: ["payment_intent", "line_items"],
        });
      },

      async refund({ paymentIntent, amount, idempotencyKey = randomUUID() }) {
        const refund = await stripe.refunds.create(
          { payment_intent: paymentIntent, amount },
          { idempotencyKey },
        );
        return { id: refund.id, status: refund.status };
      },

      constructWebhookEvent(rawBody, signature) {
        if (!signature) throw new Error("Missing Stripe-Signature header");
        return stripe.webhooks.constructEvent(
          rawBody,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET!,
        );
      },
    };

    app.decorate("stripe", wrapped);
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    stripe: StripeClient;
  }
}`}
      />

      <h2 id="5-create-a-checkout-session">5. Create a Checkout Session</h2>
      <SequenceDiagram
        title="Stripe-hosted checkout"
        participants={["Browser", "DaloyJS route", "Stripe"]}
        steps={[
          {
            from: "Browser",
            to: "DaloyJS route",
            label: "POST /checkout/stripe",
            detail: "cart id, line items, customer email",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "Stripe",
            label: "checkout.sessions.create",
            detail: "success_url, cancel_url, idempotencyKey",
            kind: "request",
          },
          {
            from: "Stripe",
            to: "DaloyJS route",
            label: "Checkout Session",
            detail: "{ id, url }",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "Browser",
            label: "200 { sessionId, url }",
            detail: "browser redirects to Stripe-hosted page",
            kind: "response",
          },
        ]}
        caption="Your server owns prices, currencies, redirect URLs, metadata, and idempotency. The browser only asks to start checkout and then redirects to Stripe."
      />
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { stripePlugin } from "./plugins/stripe.ts";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 30 }));
app.register(stripePlugin);

app.post(
  "/checkout/stripe",
  {
    operationId: "createStripeCheckoutSession",
    request: {
      body: z.object({
        cartId: z.string().min(1).max(80),
        customerEmail: z.email().optional(),
        items: z.array(
          z.object({
            name: z.string().min(1).max(120),
            quantity: z.number().int().positive().max(99),
            unitAmount: z.number().int().positive(), // cents for USD
          }),
        ).min(1).max(50),
      }),
    },
    responses: {
      200: {
        description: "checkout session",
        body: z.object({ sessionId: z.string(), url: z.url() }),
      },
    },
  },
  async ({ body, state }) => {
    const session = await state.stripe.createCheckoutSession({
      clientReferenceId: body.cartId,
      customerEmail: body.customerEmail,
      metadata: { cartId: body.cartId },
      idempotencyKey: \`checkout:\${body.cartId}\`,
      lineItems: body.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: process.env.STRIPE_CURRENCY ?? "usd",
          unit_amount: item.unitAmount,
          product_data: { name: item.name },
        },
      })),
    });

    return { status: 200, body: { sessionId: session.id, url: session.url } };
  },
);`}
      />

      <h2 id="6-redirect-from-the-browser">6. Redirect from the browser</h2>
      <p>
        If your route returns a <code>session.url</code>
        {", "}a plain
        <code>window.location.assign(url)</code> is enough. If you prefer
        redirecting by Session ID, load Stripe.js from{" "}
        <code>@stripe/stripe-js</code>
        and call <code>redirectToCheckout</code>
        {": "}
      </p>
      <CodeBlock
        code={`import { loadStripe } from "@stripe/stripe-js";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export async function startCheckout(cartId: string) {
  const res = await fetch("/checkout/stripe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cartId, items: collectCartItems() }),
  });
  const { sessionId, url } = await res.json();

  const stripe = await stripePromise;
  if (stripe) {
    await stripe.redirectToCheckout({ sessionId });
    return;
  }

  window.location.assign(url);
}`}
      />
      <p className="text-sm text-muted-foreground">
        <strong>CSP note:</strong> include <code>https://js.stripe.com</code>
        and Stripe&apos;s required frame/connect endpoints in your content
        security policy when you render Stripe.js or Elements.
      </p>

      <h2 id="7-receive-and-verify-webhooks">7. Receive and verify webhooks</h2>
      <SequenceDiagram
        title="Webhook verification"
        participants={["Stripe", "DaloyJS route", "Your queue"]}
        steps={[
          {
            from: "Stripe",
            to: "DaloyJS route",
            label: "POST /webhooks/stripe",
            detail: "Stripe-Signature over raw body",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "webhooks.constructEvent",
            detail: "raw body + signature + whsec_ secret",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "Stripe",
            label: "400 when verification fails",
            detail: "{ error: 'invalid signature' }",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "Your queue",
            label: "Dedupe on event.id, then enqueue and ack",
            detail: "200 fast, fulfill asynchronously",
            kind: "async",
          },
        ]}
        caption="Stripe webhook verification fails if the body was parsed or re-serialized first. Verify the raw bytes, dedupe on event.id, and handle fulfillment from the signed event or by refetching the Checkout Session."
      />
      <CodeBlock
        code={`import { z } from "zod";
import type Stripe from "stripe";
import { readBodyLimited } from "@daloyjs/core";

app.post(
  "/webhooks/stripe",
  {
    operationId: "stripeWebhook",
    responses: {
      200: { description: "ack", body: z.object({ ok: z.literal(true) }) },
      400: { description: "bad signature", body: z.object({ error: z.string() }) },
    },
  },
  async ({ request, state }) => {
    // Keep webhook reads bounded and preserve the exact bytes Stripe signed.
    const raw = Buffer.from(await readBodyLimited(request, 1_048_576));
    const signature = request.headers.get("stripe-signature");

    let event: Stripe.Event;
    try {
      event = state.stripe.constructWebhookEvent(raw, signature);
    } catch {
      return { status: 400, body: { error: "invalid signature" } };
    }

    if (await seenStripeEvent(event.id)) {
      return { status: 200, body: { ok: true as const } };
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Fulfill idempotently on session.id or session.payment_intent.
        await enqueuePaidOrder(session.id, session.client_reference_id);
        break;
      }
      case "checkout.session.expired":
        // Release cart reservation, if you hold one.
        break;
      case "charge.refunded":
      case "refund.updated":
        // Reconcile refund state.
        break;
    }

    return { status: 200, body: { ok: true as const } };
  },
);`}
      />
      <p>During local development, forward events with the Stripe CLI:</p>
      <CodeBlock
        code={`stripe listen --forward-to localhost:3000/webhooks/stripe`}
      />
      <p>
        The CLI prints a temporary <code>whsec_</code> secret. Use that local
        secret for forwarded events; do not mix it with the Dashboard endpoint
        secret.
      </p>

      <h2 id="8-refunds">8. Refunds</h2>
      <CodeBlock
        code={`// Full refund by PaymentIntent id.
await state.stripe.refund({
  paymentIntent: "pi_xxx",
  idempotencyKey: "refund:order_123",
});

// Partial refund, amount is in the smallest currency unit.
await state.stripe.refund({
  paymentIntent: "pi_xxx",
  amount: 250, // $2.50 for USD
  idempotencyKey: "refund:order_123:partial_1",
});`}
      />

      <h2 id="errors">Errors</h2>
      <p>
        The SDK throws structured <code>Stripe.errors.StripeError</code>
        subclasses for API, card, authentication, rate-limit, and connection
        failures. Preserve <code>requestId</code>
        {", "}<code>code</code>
        {", "}
        <code>decline_code</code>
        {", "}and <code>payment_intent</code> in internal logs, but return a
        stable <Link href="/docs/errors">problem+json</Link> shape to clients.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        The official <code>stripe</code> package is a server-side SDK and
        currently supports Node.js LTS versions 18+. It fits DaloyJS Node,
        serverless, and AWS Lambda deployments. The same SDK also documents a
        Deno npm import path. For strict edge workers, keep Checkout creation on
        a Node route or call Stripe&apos;s REST API with <code>fetch</code> from
        an isolated plugin instead of assuming every Node SDK feature works in
        the worker runtime.
      </p>

      <h2 id="modernisation-notes">Modernisation notes</h2>
      <ul>
        <li>
          <strong>Do not make Stripe a framework dependency.</strong> Keep it in
          the application, behind a plugin, so apps that use Braintree, Adyen,
          Square, or no payments at all keep a dependency-free DaloyJS core.
        </li>
        <li>
          <strong>
            Use Checkout first, Payment Intents when you need control.
          </strong>{" "}
          Payment Intents are the lower-level API for custom payment forms and
          advanced flows. Start there only when hosted Checkout cannot model the
          experience.
        </li>
        <li>
          <strong>Pin your API behavior deliberately.</strong> Stripe SDK types
          track the latest API shape. If your account uses an older pinned API
          version, test upgrades carefully and keep type suppressions rare and
          local.
        </li>
        <li>
          <strong>Never use real card details in test mode.</strong> Use Stripe
          test cards or test <code>PaymentMethod</code> IDs. Real payment method
          details belong only in live mode through Stripe-hosted collection.
        </li>
      </ul>

      <p>
        See also the{" "}
        <Link href={"/docs/payments" as Route}>payments overview</Link>
        {", "}
        <Link href={"/docs/payments/braintree" as Route}>Braintree guide</Link>
        {", "}
        <Link href={"/docs/payments/square" as Route}>Square guide</Link>
        {", "}and <Link href="/docs/errors">problem+json errors</Link>.
      </p>
    </>
  );
}
