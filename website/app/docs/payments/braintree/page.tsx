import Link from "next/link";
import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Accept PayPal & cards with Braintree in DaloyJS",
  description:
    "Accept PayPal, cards, Venmo, Apple Pay, and Google Pay from a DaloyJS API using the official Braintree Node SDK. Covers gateway setup, client tokens, transaction.sale, webhook signature parsing, and Node-only runtime caveats.",
  path: "/docs/payments/braintree",
  keywords: [
    "DaloyJS Braintree",
    "braintree node sdk",
    "PayPal server-side Node",
    "BraintreeGateway",
    "Braintree webhook parse Node",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Accept PayPal &amp; cards with Braintree in DaloyJS</h1>
      <p>
        <a
          href="https://www.braintreepayments.com/"
          target="_blank"
          rel="noreferrer"
        >
          Braintree
        </a>{" "}
        is PayPal&apos;s full-stack payments gateway. A single integration gives
        you PayPal, cards, Venmo, Apple Pay, Google Pay, ACH, and local payment
        methods. This guide uses the official{" "}
        <a
          href="https://github.com/braintree/braintree_node"
          target="_blank"
          rel="noreferrer"
        >
          <code>braintree</code>
        </a>{" "}
        Node SDK and the modern{" "}
        <a
          href="https://developer.paypal.com/braintree/docs/guides/paypal/server-side/node/"
          target="_blank"
          rel="noreferrer"
        >
          server-side PayPal flow
        </a>
        .
      </p>

      <h2 id="pick-the-right-braintree-sdk">Pick the right Braintree SDK</h2>
      <p>
        Braintree ships two server SDKs and PayPal ships a third. Don&apos;t mix
        them up:
      </p>
      <ul>
        <li>
          <strong>
            <code>braintree</code> (this guide)
          </strong>
          : the long-standing Braintree server SDK. Uses the classic REST/XML
          gateway with a polished promise-based API. Production-ready, actively
          maintained, and what every Braintree docs example uses.
        </li>
        <li>
          <strong>
            <code>@braintree/graphql-client-node</code>
          </strong>
          : a thin GraphQL client for the same gateway. Useful if you want to
          write GraphQL queries directly, but you&apos;ll re-implement a lot
          that the classic SDK gives you for free. Skip unless you have a
          reason.
        </li>
        <li>
          <strong>
            <code>@paypal/paypal-server-sdk</code>
          </strong>
          : the <em>PayPal REST</em> SDK (Checkout / Orders v2). Different
          product, different account, different API. Don&apos;t install it for a
          Braintree integration.
        </li>
      </ul>

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Sign up for a{" "}
          <a
            href="https://www.braintreepayments.com/sandbox"
            target="_blank"
            rel="noreferrer"
          >
            sandbox account
          </a>{" "}
          and grab your{" "}
          <a
            href="https://developer.paypal.com/braintree/articles/control-panel/important-gateway-credentials"
            target="_blank"
            rel="noreferrer"
          >
            Merchant ID, Public Key, and Private Key
          </a>{" "}
          from the sandbox control panel.
        </li>
        <li>
          In <strong>Settings → Processing</strong>, link your sandbox PayPal
          Business account so PayPal nonces flow through the same gateway as
          cards.
        </li>
        <li>
          When you&apos;re ready, repeat with a production account and swap{" "}
          <code>Environment.Sandbox</code> for{" "}
          <code>Environment.Production</code>.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add braintree`} />
      <p>
        The package bundles its own TypeScript declarations, no{" "}
        <code>@types/braintree</code> needed.
      </p>

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
BRAINTREE_ENVIRONMENT=sandbox          # or "production"
BRAINTREE_MERCHANT_ID=use_your_merchant_id
BRAINTREE_PUBLIC_KEY=use_your_public_key
BRAINTREE_PRIVATE_KEY=use_your_private_key`}
      />
      <p>
        Public and private keys are <em>both</em> server-side secrets despite
        the names, the word &ldquo;public&rdquo; here means &ldquo;safe to log
        alongside the merchant ID&rdquo;, not &ldquo;safe to ship to the
        browser&rdquo;. Keep both out of client bundles.
      </p>

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/braintree.ts
import braintree, { BraintreeGateway, Environment } from "braintree";
import type { App } from "@daloyjs/core";

function envFor(name: string | undefined) {
  switch (name) {
    case "production":
      return Environment.Production;
    case "qa":
      return Environment.Qa;
    case "development":
      return Environment.Development;
    case "sandbox":
    default:
      return Environment.Sandbox;
  }
}

const gateway: BraintreeGateway = new braintree.BraintreeGateway({
  environment: envFor(process.env.BRAINTREE_ENVIRONMENT),
  merchantId: process.env.BRAINTREE_MERCHANT_ID!,
  publicKey: process.env.BRAINTREE_PUBLIC_KEY!,
  privateKey: process.env.BRAINTREE_PRIVATE_KEY!,
});

export interface BraintreeClient {
  gateway: BraintreeGateway;
  clientToken(customerId?: string): Promise<string>;
  sale(input: {
    amount: string;            // string, two-decimal - e.g. "10.00"
    paymentMethodNonce: string;
    deviceData?: string;
    orderId?: string;
    customerId?: string;
    submitForSettlement?: boolean;
  }): Promise<{ id: string; status: string }>;
  parseWebhook(signature: string, payload: string): Promise<unknown>;
}

export const braintreePlugin = {
  name: "braintree",
  register(app: App) {
    const client: BraintreeClient = {
      gateway,
      async clientToken(customerId) {
        const res = await gateway.clientToken.generate(
          customerId ? { customerId } : {},
        );
        return res.clientToken;
      },
      async sale(input) {
        const result = await gateway.transaction.sale({
          amount: input.amount,
          paymentMethodNonce: input.paymentMethodNonce,
          deviceData: input.deviceData,
          orderId: input.orderId,
          customerId: input.customerId,
          options: {
            submitForSettlement: input.submitForSettlement ?? true,
          },
        });
        if (!result.success) {
          // result.message + result.errors.deepErrors() carry the details.
          throw Object.assign(new Error(result.message), {
            code: "BRAINTREE_SALE_FAILED",
            errors: result.errors?.deepErrors?.() ?? [],
          });
        }
        return { id: result.transaction.id, status: result.transaction.status };
      },
      parseWebhook(signature, payload) {
        return gateway.webhookNotification.parse(signature, payload);
      },
    };
    app.decorate("braintree", client);
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    braintree: BraintreeClient;
  }
}`}
      />

      <h2 id="5-generate-a-client-token">5. Generate a client token</h2>
      <p>
        Your browser SDK (Drop-in, Hosted Fields, Fastlane) needs a fresh client
        token to talk to Braintree. Pass an optional <code>customerId</code> so
        returning customers see their vaulted payment methods:
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { braintreePlugin } from "./plugins/braintree.ts";

const app = new App();
app.use(secureHeaders());
app.register(braintreePlugin);

app.route({
  method: "POST",
  path: "/checkout/client-token",
  operationId: "createBraintreeClientToken",
  request: {
    body: z.object({ customerId: z.string().optional() }),
  },
  responses: {
    200: { description: "ok", body: z.object({ clientToken: z.string() }) },
  },
  handler: async ({ body, state }) => ({
    status: 200,
    body: { clientToken: await state.braintree.clientToken(body.customerId) },
  }),
});`}
      />

      <h2 id="6-create-a-transaction">6. Create a transaction</h2>
      <p>
        Once the browser SDK returns a <code>paymentMethodNonce</code> (and, for
        fraud scoring,{" "}
        <a
          href="https://developer.paypal.com/braintree/docs/guides/premium-fraud-management-tools/client-side"
          target="_blank"
          rel="noreferrer"
        >
          <code>deviceData</code>
        </a>
        ), submit a sale. Always send <code>amount</code> as a string with two
        decimals, floats lose pennies.
      </p>
      <CodeBlock
        code={`app.route({
  method: "POST",
  path: "/checkout",
  operationId: "checkout",
  request: {
    body: z.object({
      amount: z.string().regex(/^\\d+\\.\\d{2}$/),
      paymentMethodNonce: z.string().min(1),
      deviceData: z.string().optional(),
      orderId: z.string().max(36).optional(),
    }),
  },
  responses: {
    201: {
      description: "transaction settled or submitted",
      body: z.object({ id: z.string(), status: z.string() }),
    },
  },
  handler: async ({ body, state }) => {
    const tx = await state.braintree.sale({
      amount: body.amount,
      paymentMethodNonce: body.paymentMethodNonce,
      deviceData: body.deviceData,
      orderId: body.orderId,
      submitForSettlement: true,
    });
    return { status: 201, body: tx };
  },
});`}
      />
      <p>
        For <strong>recurring</strong> charges that re-use a vaulted payment
        method while the customer is offline, swap{" "}
        <code>paymentMethodNonce</code> for <code>paymentMethodToken</code> and
        add <code>transactionSource: &quot;recurring&quot;</code> to the sale
        request. Braintree&apos;s built-in Recurring Billing sets this for you;
        only do it manually if you wrote your own subscription engine.
      </p>

      <h2 id="7-receive-and-verify-webhooks">7. Receive and verify webhooks</h2>
      <SequenceDiagram
        title="Webhook verification"
        participants={["Braintree", "DaloyJS route", "Your queue"]}
        steps={[
          {
            from: "Braintree",
            to: "DaloyJS route",
            label: "POST /webhooks/braintree",
            detail: "form-encoded bt_signature + bt_payload",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "webhookNotification.parse() verifies the signature",
            detail: "throws InvalidSignatureError on tamper",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "Braintree",
            label: "401 when parse throws",
            detail: "{ error: 'invalid signature' }",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "Your queue",
            label: "Enqueue the notification, then ack",
            detail: "200 within ~30s",
            kind: "async",
          },
        ]}
        caption="The SDK verifies the signature for you, so reject parse failures with 401, hand the notification to a background job, and ack within 30 seconds."
      />
      <p>
        Braintree posts webhooks as{" "}
        <code>application/x-www-form-urlencoded</code> with two fields:{" "}
        <code>bt_signature</code> and <code>bt_payload</code>. Pass them to{" "}
        <code>webhookNotification.parse()</code>, which verifies the signature
        and rejects tampered payloads with an <code>InvalidSignatureError</code>
        . You don&apos;t hash anything yourself.
      </p>
      <CodeBlock
        code={`app.route({
  method: "POST",
  path: "/webhooks/braintree",
  operationId: "braintreeWebhook",
  request: {
    // Braintree posts form-encoded data.
    body: z.object({
      bt_signature: z.string(),
      bt_payload: z.string(),
    }),
  },
  responses: {
    200: { description: "ack", body: z.object({ ok: z.literal(true) }) },
    401: { description: "bad signature", body: z.object({ error: z.string() }) },
  },
  handler: async ({ body, state }) => {
    let notification: Awaited<ReturnType<typeof state.braintree.parseWebhook>>;
    try {
      notification = await state.braintree.parseWebhook(body.bt_signature, body.bt_payload);
    } catch {
      return { status: 401, body: { error: "invalid signature" } };
    }

    // Notification shape: { kind, timestamp, transaction?, subscription?, dispute?, ... }
    // Hand off to a queue; ack within 30s or Braintree will retry.
    await enqueueBraintreeEvent(notification);
    return { status: 200, body: { ok: true as const } };
  },
});`}
      />
      <p>
        Braintree expects a 2xx within <strong>30 seconds</strong> and retries
        hourly for up to 24 hours in production (3 hours in sandbox). Always do
        the work in a background job and return 200 fast.
      </p>

      <h2 id="errors-and-result-objects">Errors &amp; result objects</h2>
      <p>
        The SDK doesn&apos;t throw on declined transactions, it resolves with{" "}
        <code>result.success === false</code> and details under{" "}
        <code>result.message</code>,{" "}
        <code>result.transaction.processorResponseCode</code>, and{" "}
        <code>result.errors.deepErrors()</code>. The plugin above turns the
        unsuccessful result into a thrown error so it lands in your{" "}
        <Link href="/docs/errors">problem+json</Link> mapper. For genuine
        network failures the SDK throws an exception directly.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        The <code>braintree</code> package uses Node&apos;s <code>http</code>/
        <code>https</code> modules and reads cert/key files from disk on init.
        It runs on Node, Bun, and AWS Lambda without changes, but is{" "}
        <strong>not</strong> compatible with{" "}
        <Link href={"/docs/adapters" as Route}>Cloudflare Workers</Link> or
        Vercel. On edge runtimes, hit the{" "}
        <a
          href="https://developer.paypal.com/braintree/graphql/"
          target="_blank"
          rel="noreferrer"
        >
          Braintree GraphQL API
        </a>{" "}
        directly over <code>fetch</code> with HTTP Basic auth (public key +
        private key).
      </p>

      <h2 id="deprecation-policy">Deprecation policy</h2>
      <p>
        Braintree publishes a{" "}
        <a
          href="https://developer.paypal.com/braintree/docs/reference/general/server-sdk-deprecation-policy/"
          target="_blank"
          rel="noreferrer"
        >
          server SDK deprecation policy
        </a>
        : major versions are supported for 3 years and you should pin a recent
        major in
        <code>package.json</code>. Stay current, old SDKs lose support for new
        payment methods, new fields, and security patches.
      </p>

      <p>
        See also the{" "}
        <Link href={"/docs/payments" as Route}>payments overview</Link>,{" "}
        <Link href="/docs/errors">problem+json errors</Link>, and{" "}
        <Link href="/docs/security">rate-limit + security hardening</Link>.
      </p>
    </>
  );
}
