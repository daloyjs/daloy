import Link from "next/link";
import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Accept cards with Authorize.Net in DaloyJS",
  description:
    "Charge cards and verify webhooks with the official Authorize.Net Node SDK (authorizenet) from a DaloyJS API. Covers ApiContracts/ApiControllers, promisifying the callback API, Accept.js nonces, environment switching, and HMAC-SHA512 signature verification.",
  path: "/docs/payments/authorize-net",
  keywords: [
    "DaloyJS Authorize.Net",
    "authorizenet npm",
    "ApiContracts ApiControllers",
    "Accept.js nonce server",
    "X-ANET-Signature HMAC-SHA512",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Accept cards with Authorize.Net in DaloyJS</h1>
      <p>
        <a href="https://www.authorize.net/" target="_blank" rel="noreferrer">
          Authorize.Net
        </a>{" "}
        (a Visa / Cybersource brand) is one of the original US card gateways.
        This guide uses the official{" "}
        <a
          href="https://github.com/AuthorizeNet/sdk-node"
          target="_blank"
          rel="noreferrer"
        >
          <code>authorizenet</code>
        </a>{" "}
        Node SDK to charge cards via the{" "}
        <a
          href="https://developer.authorize.net/api/reference/index.html"
          target="_blank"
          rel="noreferrer"
        >
          Authorize.Net API</a>
        {", "}and the separate JSON Webhooks REST API to receive event
        notifications.
      </p>

      <h2 id="what-you-should-know-up-front">What you should know up front</h2>
      <ul>
        <li>
          <strong>It&apos;s a thin XML wrapper.</strong> Requests are built with{" "}
          <code>ApiContracts.*</code> classes and sent with{" "}
          <code>ApiControllers.*</code> controllers. There&apos;s no fluent
          client and no Promises by default, every controller exposes{" "}
          <code>.execute(callback)</code>
          {". "}Wrap it with <code>util.promisify</code> for a sane async API.
        </li>
        <li>
          <strong>Don&apos;t POST raw card numbers from a browser.</strong> Use{" "}
          <a
            href="https://developer.authorize.net/api/reference/features/acceptjs.html"
            target="_blank"
            rel="noreferrer"
          >
            Accept.js
          </a>{" "}
          or{" "}
          <a
            href="https://developer.authorize.net/api/reference/features/accept-hosted.html"
            target="_blank"
            rel="noreferrer"
          >
            Accept Hosted
          </a>{" "}
          on the client to tokenise the card into an <code>opaqueData</code>{" "}
          nonce. Sending raw PANs through your server puts you in full PCI-DSS
          SAQ-D scope.
        </li>
        <li>
          <strong>Webhooks are a separate API.</strong> Subscribe and verify
          against <code>https://api.authorize.net/rest/v1/webhooks</code> (or
          the <code>apitest</code> host), the XML transactions SDK doesn&apos;t
          handle them. Signatures use HMAC-SHA512 with a dedicated{" "}
          <em>Signature Key</em>
          {", "}<strong>not</strong> the Transaction Key.
        </li>
        <li>
          <strong>Node 14+ &amp; TLS 1.2.</strong> Anything older is rejected at
          the connection layer.
        </li>
      </ul>

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Create a{" "}
          <a
            href="https://developer.authorize.net/hello_world/sandbox/"
            target="_blank"
            rel="noreferrer"
          >
            sandbox account
          </a>{" "}
          and copy your <strong>API Login ID</strong> and{" "}
          <strong>Transaction Key</strong> from{" "}
          <em>
            Account → Settings → Security Settings → API Credentials and Keys</em>
          {"."}
        </li>
        <li>
          On the same screen, generate a <strong>Signature Key</strong>
          {". "}
          You&apos;ll need this to verify webhook signatures.
        </li>
        <li>
          When you&apos;re ready for production, repeat with a live account and
          swap <code>endpoint.sandbox</code> for{" "}
          <code>endpoint.production</code>.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add authorizenet`} />
      <p>
        The package ships its own TypeScript declarations, but they&apos;re
        hand-written and not exhaustive, expect to <code>as any</code> in a few
        spots when you reach for newer fields.
      </p>

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
AUTHNET_ENVIRONMENT=sandbox          # or "production"
AUTHNET_API_LOGIN_ID=use_your_api_login_id
AUTHNET_TRANSACTION_KEY=use_your_transaction_key
AUTHNET_SIGNATURE_KEY=use_your_signature_key   # hex string from the merchant interface`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/authorizenet.ts
import { promisify } from "node:util";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  APIContracts as ApiContracts,
  APIControllers as ApiControllers,
  Constants as SDKConstants,
} from "authorizenet";
import type { App } from "@daloyjs/core";

const endpoint =
  process.env.AUTHNET_ENVIRONMENT === "production"
    ? SDKConstants.endpoint.production
    : SDKConstants.endpoint.sandbox;

function merchantAuth() {
  const auth = new ApiContracts.MerchantAuthenticationType();
  auth.setName(process.env.AUTHNET_API_LOGIN_ID!);
  auth.setTransactionKey(process.env.AUTHNET_TRANSACTION_KEY!);
  return auth;
}

// Centralise the callback-to-promise wrapping in one place.
function runController<TController extends { execute: (cb: () => void) => void; getResponse: () => unknown }>(
  controller: TController,
): Promise<unknown> {
  controller.setEnvironment(endpoint);
  return new Promise((resolve) => {
    controller.execute(() => resolve(controller.getResponse()));
  });
}

export interface AuthorizeNetClient {
  chargeOpaqueData(input: {
    amount: string;                 // "10.00" - string, two decimals.
    dataDescriptor: string;         // e.g. "COMMON.ACCEPT.INAPP.PAYMENT"
    dataValue: string;              // Accept.js nonce.
    invoiceNumber?: string;
    customerEmail?: string;
    customerIp?: string;
  }): Promise<{ transId: string; authCode: string; accountNumber: string }>;
  verifyWebhook(headers: Headers, rawBody: Buffer): boolean;
}

function buildSaleRequest(input: Parameters<AuthorizeNetClient["chargeOpaqueData"]>[0]) {
  const opaque = new ApiContracts.OpaqueDataType();
  opaque.setDataDescriptor(input.dataDescriptor);
  opaque.setDataValue(input.dataValue);

  const payment = new ApiContracts.PaymentType();
  payment.setOpaqueData(opaque);

  const order = new ApiContracts.OrderType();
  if (input.invoiceNumber) order.setInvoiceNumber(input.invoiceNumber);

  const tx = new ApiContracts.TransactionRequestType();
  tx.setTransactionType(ApiContracts.TransactionTypeEnum.AUTHCAPTURETRANSACTION);
  tx.setPayment(payment);
  tx.setAmount(input.amount);
  tx.setOrder(order);
  if (input.customerIp) tx.setCustomerIP(input.customerIp);
  if (input.customerEmail) {
    const customer = new ApiContracts.CustomerDataType();
    customer.setEmail(input.customerEmail);
    tx.setCustomer(customer);
  }

  const req = new ApiContracts.CreateTransactionRequest();
  req.setMerchantAuthentication(merchantAuth());
  req.setTransactionRequest(tx);
  return req;
}

function verifyAuthorizeNetSignature(rawBody: Buffer, headerValue: string | null) {
  if (!headerValue) return false;
  // The header looks like "sha512=ABCDEF..." - strip the prefix if present.
  const provided = headerValue.startsWith("sha512=")
    ? headerValue.slice("sha512=".length)
    : headerValue;
  const computed = createHmac("sha512", process.env.AUTHNET_SIGNATURE_KEY!)
    .update(rawBody)
    .digest("hex")
    .toUpperCase();
  const a = Buffer.from(provided.toUpperCase(), "utf8");
  const b = Buffer.from(computed, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const authorizeNetPlugin = {
  name: "authorizenet",
  register(app: App) {
    const client: AuthorizeNetClient = {
      async chargeOpaqueData(input) {
        const req = buildSaleRequest(input);
        const controller = new ApiControllers.CreateTransactionController(req.getJSON());
        const raw = (await runController(controller)) as Record<string, unknown>;
        const response = new ApiContracts.CreateTransactionResponse(raw);

        const messages = response.getMessages();
        if (messages?.getResultCode() !== ApiContracts.MessageTypeEnum.OK) {
          const first = messages?.getMessage()?.[0];
          throw Object.assign(new Error(first?.getText() ?? "Authorize.Net request failed"), {
            code: first?.getCode(),
          });
        }

        const txResp = response.getTransactionResponse();
        // responseCode "1" = approved. Anything else (2 declined, 3 error, 4 held) is a failure.
        if (!txResp || txResp.getResponseCode() !== "1") {
          const err = txResp?.getErrors()?.getError()?.[0];
          throw Object.assign(new Error(err?.getErrorText() ?? "Transaction not approved"), {
            code: err?.getErrorCode() ?? "DECLINED",
            transId: txResp?.getTransId(),
          });
        }

        return {
          transId: txResp.getTransId(),
          authCode: txResp.getAuthCode(),
          accountNumber: txResp.getAccountNumber(),
        };
      },
      verifyWebhook(headers, rawBody) {
        return verifyAuthorizeNetSignature(rawBody, headers.get("x-anet-signature"));
      },
    };
    app.decorate("authnet", client);
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    authnet: AuthorizeNetClient;
  }
}`}
      />
      <p>
        Why <code>req.getJSON()</code>? The SDK builds an XML envelope
        internally, but the controllers want a serialised JSON snapshot of the
        request graph. It&apos;s an awkward shape, that&apos;s the SDK, not a
        typo.
      </p>

      <h2 id="5-charge-an-accept-js-nonce">5. Charge an Accept.js nonce</h2>
      <p>
        Your frontend obtains an <code>opaqueData</code> nonce with Accept.js (<code>dataDescriptor: &quot;COMMON.ACCEPT.INAPP.PAYMENT&quot;</code> for
        browser-side Accept, or <code>COMMON.APPLE.INAPP.PAYMENT</code> /{" "}
        <code>COMMON.GOOGLE.INAPP.PAYMENT</code> for wallets). Your server only
        ever sees the nonce, never the card number.
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { authorizeNetPlugin } from "./plugins/authorizenet.ts";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 30 }));
app.register(authorizeNetPlugin);

app.post(
  "/checkout",
  {
    operationId: "checkout",
    request: {
      body: z.object({
        amount: z.string().regex(/^\\d+\\.\\d{2}$/),
        dataDescriptor: z.string().min(1),
        dataValue: z.string().min(1),
        invoiceNumber: z.string().max(20).optional(),
        email: z.email().optional(),
      }),
    },
    responses: {
      201: {
        description: "approved",
        body: z.object({
          transId: z.string(),
          authCode: z.string(),
          last4: z.string(),
        }),
      },
    },
  },
  async ({ body, request, state }) => {
    const result = await state.authnet.chargeOpaqueData({
      amount: body.amount,
      dataDescriptor: body.dataDescriptor,
      dataValue: body.dataValue,
      invoiceNumber: body.invoiceNumber,
      customerEmail: body.email,
      customerIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    });
    return {
      status: 201,
      body: {
        transId: result.transId,
        authCode: result.authCode,
        last4: result.accountNumber.replace(/^X+/, ""),
      },
    };
  },
);`}
      />
      <p>
        Refunds, voids, and prior-auth captures all go through the same{" "}
        <code>CreateTransactionController</code> with a different{" "}
        <code>transactionType</code> (<code>refundTransaction</code>
        {", "}
        <code>voidTransaction</code>
        {", "}<code>priorAuthCaptureTransaction</code>) plus a{" "}
        <code>refTransId</code>
        {". "}Reuse <code>runController</code> from the plugin and follow the
        same response shape.
      </p>

      <h2 id="6-subscribe-to-webhooks">6. Subscribe to webhooks</h2>
      <p>
        Webhooks aren&apos;t in the XML SDK. Use the REST API with HTTP Basic
        auth (API Login ID + Transaction Key), once per environment, usually as
        a script or admin endpoint, not on every boot:
      </p>
      <CodeBlock
        code={`const host =
  process.env.AUTHNET_ENVIRONMENT === "production"
    ? "https://api.authorize.net"
    : "https://apitest.authorize.net";

const basic = Buffer.from(
  \`\${process.env.AUTHNET_API_LOGIN_ID}:\${process.env.AUTHNET_TRANSACTION_KEY}\`,
).toString("base64");

await fetch(\`\${host}/rest/v1/webhooks\`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: \`Basic \${basic}\`,
  },
  body: JSON.stringify({
    name: "Acme webhooks",
    url: "https://api.acme.com/webhooks/authorizenet",
    eventTypes: [
      "net.authorize.payment.authcapture.created",
      "net.authorize.payment.refund.created",
      "net.authorize.payment.void.created",
      "net.authorize.customer.subscription.expiring",
    ],
    status: "active",
  }),
});`}
      />

      <h2 id="7-verify-webhook-deliveries">7. Verify webhook deliveries</h2>
      <SequenceDiagram
        title="Webhook verification"
        participants={["Authorize.Net", "DaloyJS route", "Your queue"]}
        steps={[
          {
            from: "Authorize.Net",
            to: "DaloyJS route",
            label: "POST /webhooks/authorizenet",
            detail: "X-ANET-Signature: sha512=... over raw body",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "Recompute HMAC-SHA512 with the Signature Key",
            detail: "timingSafeEqual vs the header digest",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "Authorize.Net",
            label: "401 when the digest does not match",
            detail: "{ error: 'invalid signature' }",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "Your queue",
            label: "Dedupe on notificationId, then enqueue and ack",
            detail: "200, fetch the full record async",
            kind: "async",
          },
        ]}
        caption="Hash the raw bytes with the dedicated Signature Key before JSON.parse, reject mismatches with 401, dedupe on notificationId, then ack and fetch the full record in the background."
      />
      <p>
        Authorize.Net signs each notification with HMAC-SHA512 over the raw body
        using the Signature Key, and sends the hex digest in the{" "}
        <code>X-ANET-Signature</code> header (often prefixed with{" "}
        <code>sha512=</code>). Hash bytes <em>before</em> JSON.parse:
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { readBodyLimited } from "@daloyjs/core";

app.post(
  "/webhooks/authorizenet",
  {
    operationId: "authorizenetWebhook",
    responses: {
      200: { description: "ack", body: z.object({ ok: z.literal(true) }) },
      401: { description: "bad signature", body: z.object({ error: z.string() }) },
    },
  },
  async ({ request, state }) => {
    // Keep webhook reads bounded and preserve the exact bytes Authorize.Net signed.
    const raw = Buffer.from(await readBodyLimited(request, 1_048_576));
    if (!state.authnet.verifyWebhook(request.headers, raw)) {
      return { status: 401, body: { error: "invalid signature" } };
    }

    const event = JSON.parse(raw.toString("utf8")) as {
      notificationId: string;
      eventType: string;
      eventDate: string;
      webhookId: string;
      payload: { entityName: "transaction" | "customerProfile" | "customerPaymentProfile" | "subscription"; id: string };
    };

    if (await seen(event.notificationId)) {
      return { status: 200, body: { ok: true as const } };
    }

    // Webhook payloads are intentionally minimal. For the full record, call
    // getTransactionDetailsRequest / getCustomerProfileRequest / ARBGetSubscriptionRequest.
    await enqueueAuthnetEvent(event);
    return { status: 200, body: { ok: true as const } };
  },
);`}
      />
      <p>
        Ack fast. Authorize.Net retries failed deliveries 10 times, 3× at
        3-minute intervals, 3× at 8-hour intervals, 4× at 48-hour intervals, and
        then marks the webhook inactive. Do the heavy work in a queue.
      </p>

      <h2 id="errors-and-result-objects">Errors &amp; result objects</h2>
      <p>
        There are two layers of failure. The outer <code>messages</code> block
        reports request-level errors (auth, schema, throttling). When
        that&apos;s OK, the inner <code>transactionResponse</code> still has a{" "}
        <code>responseCode</code> of <code>2</code> (decline), <code>3</code>{" "}
        (error), or <code>4</code> (held for review). The plugin above collapses
        both into thrown errors; route them through{" "}
        <Link href="/docs/errors">problem+json</Link>.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        The SDK uses <code>axios</code> over Node&apos;s <code>https</code>
        {", "}
        requires Node 14+ and TLS 1.2, and isn&apos;t designed for{" "}
        <Link href={"/docs/adapters" as Route}>Cloudflare Workers</Link> or
        Vercel. On an edge runtime, POST JSON straight to{" "}
        <code>https://api.authorize.net/xml/v1/request.api</code> with{" "}
        <code>fetch</code> instead, the gateway accepts the same JSON envelope
        that the SDK builds.
      </p>

      <h2 id="modernisation-notes">Modernisation notes</h2>
      <ul>
        <li>
          <strong>
            Use <code>transHashSha2</code>
            {", "}not <code>transHash</code>.
          </strong>{" "}
          The MD5-based <code>transHash</code> field is being phased out.
          Compare against <code>transHashSha2</code> if you echo a hash back for
          receipt-style verification.
        </li>
        <li>
          <strong>
            Skip the <code>shopify-style</code> auto-retry config.
          </strong>{" "}
          The SDK has no built-in retry; if you need it, wrap{" "}
          <code>runController</code> with your own back-off on transient network
          errors only, never on declines.
        </li>
        <li>
          <strong>Prefer Customer Profiles for repeat business.</strong> Vault
          the card into a customer payment profile on first charge, then bill
          subsequent transactions by <code>profile.customerProfileId</code> /{" "}
          <code>paymentProfileId</code> so you never touch the nonce twice.
        </li>
      </ul>

      <p>
        See also the{" "}
        <Link href={"/docs/payments" as Route}>payments overview</Link>
        {", "}
        <Link href={"/docs/payments/braintree" as Route}>Braintree guide</Link>
        {", "}
        and <Link href="/docs/errors">problem+json errors</Link>.
      </p>
    </>
  );
}
