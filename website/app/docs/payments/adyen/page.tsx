import Link from "next/link";
import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Accept payments with Adyen in DaloyJS",
  description:
    "Integrate Adyen's official @adyen/api-library Node SDK with a DaloyJS API. Covers the Sessions flow for Drop-in / Components, direct /payments calls, the live URL prefix, hmacValidator for Standard webhook notifications, and idempotency keys.",
  path: "/docs/payments/adyen",
  keywords: [
    "DaloyJS Adyen",
    "@adyen/api-library",
    "Adyen Sessions flow",
    "hmacValidator",
    "Adyen Standard webhook HMAC",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Accept payments with Adyen in DaloyJS</h1>
      <p>
        <a href="https://www.adyen.com/" target="_blank" rel="noreferrer">
          Adyen
        </a>{" "}
        is a single platform for cards, wallets, and local payment methods
        across Europe, the US, APAC, and LATAM. This guide uses the official{" "}
        <a
          href="https://github.com/Adyen/adyen-node-api-library"
          target="_blank"
          rel="noreferrer"
        >
          <code>@adyen/api-library</code>
        </a>{" "}
        Node SDK (Checkout API <strong>v71</strong> as of v30.x) from a DaloyJS
        server, leans on the <strong>Sessions</strong> flow for the frontend,
        and verifies Standard webhook notifications with the bundled{" "}
        <code>hmacValidator</code>.
      </p>

      <h2 id="what-you-should-know-up-front">What you should know up front</h2>
      <ul>
        <li>
          <strong>
            Use Sessions, not <code>/payments</code> directly.
          </strong>{" "}
          The modern way to integrate Adyen Web Drop-in / Components is the{" "}
          <a
            href="https://docs.adyen.com/online-payments/build-your-integration/sessions-flow/"
            target="_blank"
            rel="noreferrer"
          >
            Sessions flow
          </a>
          {", "}your server creates a session, the frontend hands it to
          Drop-in, and Adyen handles 3-D Secure 2, redirects, and
          payment-method-specific quirks for you. Direct <code>/payments</code>{" "}
          is still supported for server-to-server use cases.
        </li>
        <li>
          <strong>Live needs a URL prefix.</strong> Production Checkout calls go
          through a merchant-specific endpoint. Set{" "}
          <code>liveEndpointUrlPrefix</code> on the <code>Client</code> for any
          API that requires it (Checkout, BinLookup, BalanceControl, Payout,
          Recurring). Forgetting this is the #1 cause of &ldquo;works in test,
          404 in live&rdquo;.
        </li>
        <li>
          <strong>Webhooks come signed.</strong> Each{" "}
          <em>NotificationRequestItem</em>
          carries an HMAC-SHA256 of selected fields in{" "}
          <code>additionalData.hmacSignature</code>
          {". "}Verify with <code>hmacValidator.validateHMAC</code> and respond{" "}
          <code>[accepted]</code> within ~10 seconds, or Adyen marks it failed
          and retries.
        </li>
        <li>
          <strong>Node 18+.</strong> Older runtimes are unsupported.
        </li>
        <li>
          <strong>Amounts are minor units.</strong> EUR 10.00 →{" "}
          <code>{`{ currency: "EUR", value: 1000 }`}</code>
          {". "}JPY 1000 → <code>value: 1000</code>
          {". "}Get this wrong and you&apos;ll overcharge by 100×.
        </li>
      </ul>

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Create a{" "}
          <a
            href="https://docs.adyen.com/get-started-with-adyen#test-account"
            target="_blank"
            rel="noreferrer"
          >
            test account
          </a>{" "}
          and a merchant account inside it.
        </li>
        <li>
          Generate an{" "}
          <a
            href="https://docs.adyen.com/development-resources/api-credentials"
            target="_blank"
            rel="noreferrer"
          >
            API key
          </a>{" "}
          (Customer Area → Developers → API credentials) and grant it the{" "}
          <em>Checkout webservice</em> role.
        </li>
        <li>
          Configure a <em>Standard notification</em> webhook in Customer Area →
          Developers → Webhooks. Point it at your DaloyJS endpoint, choose JSON,
          generate an <strong>HMAC key</strong>
          {", "}and enable Basic Auth.
        </li>
        <li>
          For production: note your <code>liveEndpointUrlPrefix</code> (Customer
          Area → Developers → API URLs, looks like{" "}
          <code>1797a841fbb37ca7-AdyenDemo</code>).
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add @adyen/api-library`} />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
ADYEN_ENVIRONMENT=TEST                         # or LIVE
ADYEN_API_KEY=AQE...replace_me
ADYEN_MERCHANT_ACCOUNT=YourMerchantAccountName
ADYEN_HMAC_KEY=hex_string_from_customer_area   # webhook signing key
ADYEN_WEBHOOK_USER=adyen                       # Basic auth username
ADYEN_WEBHOOK_PASSWORD=replace_me              # Basic auth password
ADYEN_LIVE_URL_PREFIX=                         # required when ENVIRONMENT=LIVE
ADYEN_CLIENT_KEY=test_...replace_me            # public key, ship to the browser`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/adyen.ts
import { Client, CheckoutAPI, Types, hmacValidator } from "@adyen/api-library";
import type { App } from "@daloyjs/core";

const environment =
  process.env.ADYEN_ENVIRONMENT === "LIVE" ? "LIVE" : "TEST";

const client = new Client({
  apiKey: process.env.ADYEN_API_KEY!,
  environment,
  ...(environment === "LIVE"
    ? { liveEndpointUrlPrefix: process.env.ADYEN_LIVE_URL_PREFIX! }
    : {}),
});

const checkout = new CheckoutAPI(client);
const validator = new hmacValidator();

export interface AdyenClient {
  createSession(input: {
    amount: { currency: string; value: number };
    reference: string;
    returnUrl: string;
    countryCode?: string;
    shopperReference?: string;
    shopperEmail?: string;
  }): Promise<Types.checkout.CreateCheckoutSessionResponse>;

  getPaymentMethods(input: {
    amount: { currency: string; value: number };
    countryCode?: string;
    channel?: "Web" | "iOS" | "Android";
  }): Promise<Types.checkout.PaymentMethodsResponse>;

  verifyWebhookItem(item: Types.notification.NotificationRequestItem): boolean;
}

export const adyenPlugin = {
  name: "adyen",
  register(app: App) {
    const adyen: AdyenClient = {
      createSession({ amount, reference, returnUrl, countryCode, shopperReference, shopperEmail }) {
        return checkout.PaymentsApi.sessions({
          merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT!,
          amount,
          reference,
          returnUrl,
          countryCode,
          shopperReference,
          shopperEmail,
        });
      },
      getPaymentMethods({ amount, countryCode, channel }) {
        return checkout.PaymentsApi.paymentMethods({
          merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT!,
          amount,
          countryCode,
          channel,
        });
      },
      verifyWebhookItem(item) {
        return validator.validateHMAC(item, process.env.ADYEN_HMAC_KEY!);
      },
    };
    app.decorate("adyen", adyen);
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    adyen: AdyenClient;
  }
}`}
      />
      <p>
        <code>hmacValidator</code> is a class, instantiate it once. The same
        instance is safe to call concurrently.
      </p>

      <h2 id="5-create-a-session-for-drop-in-components">
        5. Create a session for Drop-in / Components
      </h2>
      <p>
        The frontend renders Adyen Web with the <code>id</code> and{" "}
        <code>sessionData</code> from this response. You never touch a PAN, and
        3-D Secure 2 runs inside the Drop-in.
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { adyenPlugin } from "./plugins/adyen.ts";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 30 }));
app.register(adyenPlugin);

app.post(
  "/checkout/session",
  {
    operationId: "createAdyenSession",
    request: {
      body: z.object({
        amount: z.object({
          currency: z.string().length(3),
          value: z.number().int().positive(),  // minor units
        }),
        reference: z.string().min(1).max(80),
        countryCode: z.string().length(2).optional(),
        shopperReference: z.string().max(80).optional(),
        shopperEmail: z.email().optional(),
      }),
    },
    responses: {
      201: {
        description: "session created",
        body: z.object({
          id: z.string(),
          sessionData: z.string(),
          clientKey: z.string(),
        }),
      },
    },
  },
  async ({ body, state }) => {
    const session = await state.adyen.createSession({
      ...body,
      returnUrl: \`\${process.env.APP_URL}/checkout/return?ref=\${encodeURIComponent(body.reference)}\`,
    });
    return {
      status: 201,
      body: {
        id: session.id!,
        sessionData: session.sessionData!,
        clientKey: process.env.ADYEN_CLIENT_KEY!,
      },
    };
  },
);`}
      />

      <h2 id="6-standard-webhook-notifications">
        6. Standard webhook notifications
      </h2>
      <SequenceDiagram
        title="Webhook verification"
        participants={["Adyen", "DaloyJS route", "Your queue"]}
        steps={[
          {
            from: "Adyen",
            to: "DaloyJS route",
            label: "POST /webhooks/adyen",
            detail: "Basic auth + notificationItems[]",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "Check Basic auth, then validateHMAC per item",
            detail: "additionalData.hmacSignature, HMAC-SHA256",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "Adyen",
            label: "401 on bad Basic auth or HMAC",
            detail: "{ error: 'bad hmac' }",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "Your queue",
            label: "Dedupe on pspReference, enqueue, ack [accepted]",
            detail: "200 { notificationResponse: '[accepted]' } within ~10s",
            kind: "async",
          },
        ]}
        caption="Check Basic auth, validate the per-item HMAC with hmacValidator, dedupe on pspReference + eventCode, then always answer 200 [accepted] and process AUTHORISATION asynchronously."
      />
      <p>
        Adyen posts JSON like{" "}
        <code>{`{ "live": "false", "notificationItems": [{ "NotificationRequestItem": { ... } }] }`}</code>
        {". "}Verify HMAC, ack <em>before</em> processing, then enqueue:
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import type { Types } from "@adyen/api-library";

function basicAuthOk(headerValue: string | null): boolean {
  if (!headerValue?.startsWith("Basic ")) return false;
  const expected =
    "Basic " +
    Buffer.from(\`\${process.env.ADYEN_WEBHOOK_USER}:\${process.env.ADYEN_WEBHOOK_PASSWORD}\`).toString("base64");
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.post(
  "/webhooks/adyen",
  {
    operationId: "adyenWebhook",
    request: {
      body: z.object({
        live: z.string(),
        notificationItems: z.array(
          z.object({ NotificationRequestItem: z.any() }),
        ),
      }),
    },
    responses: {
      200: { description: "ack", body: z.object({ notificationResponse: z.literal("[accepted]") }) },
      401: { description: "unauthorized", body: z.object({ error: z.string() }) },
    },
  },
  async ({ body, request, state }) => {
    if (!basicAuthOk(request.headers.get("authorization"))) {
      return { status: 401, body: { error: "bad basic auth" } };
    }

    for (const wrapper of body.notificationItems) {
      const item = wrapper.NotificationRequestItem as Types.notification.NotificationRequestItem;
      if (!state.adyen.verifyWebhookItem(item)) {
        return { status: 401, body: { error: "bad hmac" } };
      }
      // pspReference + eventCode + success makes a stable dedupe key.
      const dedupe = \`\${item.pspReference}:\${item.eventCode}:\${item.success}\`;
      if (await seen(dedupe)) continue;
      await enqueueAdyenEvent(item);
    }

    // Always 200 + [accepted] when HMAC + auth check pass; do the work async.
    return { status: 200, body: { notificationResponse: "[accepted]" as const } };
  },
);`}
      />
      <p>
        The event you care about most is <code>AUTHORISATION</code> with{" "}
        <code>success === &quot;true&quot;</code>
        {": "}that&apos;s the canonical &quot;the money is good&quot; signal.
        The HTTP response from <code>/payments</code> or the Sessions success
        callback is only a hint; webhooks are the source of truth.
      </p>

      <h2 id="7-modifications-capture-refund-cancel">
        7. Modifications (capture, refund, cancel)
      </h2>
      <CodeBlock
        code={`// Capture an authorisation (manual capture flow).
await checkout.ModificationsApi.captureAuthorisedPayment(item.pspReference, {
  merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT!,
  amount: { currency: "EUR", value: 1000 },
});

// Refund a captured payment.
await checkout.ModificationsApi.refundCapturedPayment(item.pspReference, {
  merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT!,
  amount: { currency: "EUR", value: 1000 },
});`}
      />
      <p>
        Pass an{" "}
        <a
          href="https://docs.adyen.com/development-resources/api-idempotency/"
          target="_blank"
          rel="noreferrer"
        >
          idempotency key
        </a>{" "}
        on writes you might retry, the SDK takes one via the second{" "}
        <code>IRequest.Options</code> argument:
      </p>
      <CodeBlock
        code={`await checkout.PaymentsApi.payments(req, {
  idempotencyKey: \`order:\${orderId}\`,
});`}
      />

      <h2 id="runtimes">Runtimes</h2>
      <p>
        The SDK uses Node&apos;s built-in <code>https</code> module out of the
        box. It runs on Node 18+ and works on classic Node serverless. For{" "}
        <Link href={"/docs/adapters" as Route}>edge runtimes</Link> (Cloudflare
        Workers) you either swap in a fetch-based <code>HttpClient</code> via{" "}
        <code>
          new Client(
          {"{ httpClient: { request(endpoint, json, config) { ... } } }"})
        </code>{" "}
        or POST directly to{" "}
        <code>https://checkout-test.adyen.com/v71/sessions</code> with{" "}
        <code>fetch</code>
        {". "}The HMAC verification helper is pure JS and works anywhere.
      </p>

      <h2 id="errors">Errors</h2>
      <p>
        Adyen returns RFC-7807-shaped errors with <code>status</code>
        {", "}
        <code>errorCode</code>
        {", "}<code>message</code>
        {", "}and <code>errorType</code>
        {". "}The SDK throws <code>HttpClientException</code> with those fields
        on the <code>.error</code> object; map them through{" "}
        <Link href="/docs/errors">problem+json</Link> like other providers.
      </p>

      <h2 id="modernisation-notes">Modernisation notes</h2>
      <ul>
        <li>
          <strong>
            Sessions over <code>/payments</code> +{" "}
            <code>/payments/details</code>.
          </strong>{" "}
          The two-step Advanced flow still works, but Sessions is now the
          default in Adyen&apos;s own examples and removes a class of
          state-management bugs.
        </li>
        <li>
          <strong>Use Web v5+ on the client.</strong> v5 expects a session
          response shape identical to what <code>PaymentsApi.sessions</code>{" "}
          returns; older Drop-in versions required wiring up{" "}
          <code>onSubmit</code> / <code>onAdditionalDetails</code> callbacks by
          hand.
        </li>
        <li>
          <strong>Don&apos;t roll your own HMAC.</strong> Adyen signs a specific
          colon-delimited subset of fields with a quirky escape rule. Let{" "}
          <code>hmacValidator</code> handle it.
        </li>
        <li>
          <strong>Network tokens by default.</strong> When you tokenise with{" "}
          <code>storePaymentMethod: true</code> and reuse via{" "}
          <code>shopperInteraction: &quot;ContAuth&quot;</code>
          {", "}Adyen will route through scheme tokens automatically, no extra
          code, lower decline rate.
        </li>
      </ul>

      <p>
        See also the{" "}
        <Link href={"/docs/payments" as Route}>payments overview</Link>
        {", "}
        <Link href={"/docs/payments/braintree" as Route}>Braintree guide</Link>
        {", "}
        <Link href={"/docs/payments/authorize-net" as Route}>
          Authorize.Net guide
        </Link>
        {", "}and <Link href="/docs/errors">problem+json errors</Link>.
      </p>
    </>
  );
}
