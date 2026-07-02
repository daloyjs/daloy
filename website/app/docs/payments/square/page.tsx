import Link from "next/link";
import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Accept payments with Square in DaloyJS",
  description:
    "Integrate Square Payments from a DaloyJS API using the modern square TypeScript SDK (v40+). Covers SquareClient, BigInt money amounts, idempotency keys, the Web Payments SDK token handoff, WebhooksHelper.verifySignature with the raw body and exact notification URL, refunds, and edge-runtime compatibility.",
  path: "/docs/payments/square",
  keywords: [
    "DaloyJS Square",
    "square Node SDK",
    "SquareClient",
    "WebhooksHelper.verifySignature",
    "Square BigInt amount",
    "Square Web Payments SDK",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Accept payments with Square in DaloyJS</h1>
      <p>
        <a href="https://squareup.com/" target="_blank" rel="noreferrer">
          Square
        </a>{" "}
        gives you one API across in-person, online, and recurring payments, useful when
        the same merchant takes both Tap to Pay at the counter and Apple Pay through your
        web app. This guide uses the modern{" "}
        <a
          href="https://github.com/square/square-nodejs-sdk"
          target="_blank"
          rel="noreferrer"
        >
          <code>square</code>
        </a>{" "}
        TypeScript SDK (v40+, currently v44.x, a full rewrite from the pre-v40 line),
        Square&apos;s Web Payments SDK on the client for tokenisation, and{" "}
        <code>WebhooksHelper.verifySignature</code> on the server for webhook auth.
      </p>

      <h2 id="what-you-should-know-up-front">What you should know up front</h2>
      <ul>
        <li>
          <strong>v40+ is a full rewrite.</strong> If you see <code>squareConnect</code>,{" "}
          <code>new Client({"{ bearerAuthCredentials }"})</code>, or{" "}
          <code>paymentsApi.createPayment</code> in tutorials, you&apos;re looking at the
          legacy SDK. The new client is <code>SquareClient</code>, calls are{" "}
          <code>client.payments.create(...)</code>, and parameters are camelCase. The
          legacy surface is still shipped as <code>square/legacy</code> for migration only, 
          don&apos;t start there in 2026.
        </li>
        <li>
          <strong>Money is <code>BigInt</code>, in the smallest unit.</strong>{" "}
          <code>{`{ amount: BigInt("1000"), currency: "USD" }`}</code> means $10.00. Pass a
          plain <code>number</code> and TypeScript will (correctly) yell at you;
          <code>JSON.stringify</code>ing a BigInt without a replacer will throw at runtime.
          See the serialisation note below.
        </li>
        <li>
          <strong>You don&apos;t charge a card, you charge a <em>source ID</em>.</strong>{" "}
          The Web Payments SDK on the client returns a single-use token (
          <code>cnon:...</code> for cards, <code>cash:</code>, Apple Pay nonces, etc.) that
          your server passes as <code>sourceId</code>. Raw PANs never touch your code.
        </li>
        <li>
          <strong>Always send an <code>idempotencyKey</code>.</strong> Required on every
          mutating call (<code>payments.create</code>, <code>refunds.refundPayment</code>,
          orders, etc.). A UUID per logical attempt is the right shape, re-use it on
          retries.
        </li>
        <li>
          <strong>Webhook verification needs three things, not two.</strong>{" "}
          <code>WebhooksHelper.verifySignature</code> wants the raw body, the signature
          header, the signature key, <em>and</em> the exact <code>notificationUrl</code>{" "}
          you registered in the dashboard. Get the URL even slightly wrong (trailing slash,
          http vs https, behind a proxy that strips the host) and every event will look
          invalid.
        </li>
      </ul>

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Sign in at{" "}
          <a href="https://developer.squareup.com/apps" target="_blank" rel="noreferrer">
            developer.squareup.com
          </a>{" "}
          and create an application.
        </li>
        <li>
          Grab a <strong>Sandbox access token</strong> and your <strong>Application ID</strong>{" "}
          from <em>Credentials</em>. Also note a <strong>Location ID</strong> from{" "}
          <em>Locations</em>: every payment needs one.
        </li>
        <li>
          Under <em>Webhooks → Subscriptions</em>, add an endpoint pointing at your DaloyJS
          route, subscribe to at least <code>payment.updated</code>,{" "}
          <code>payment.created</code>, and <code>refund.updated</code>, and copy the{" "}
          <strong>Signature Key</strong>. Save the full URL exactly as Square shows it.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add square`} />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
SQUARE_ACCESS_TOKEN=EAAA_replace_me                  # sandbox or production access token
SQUARE_APPLICATION_ID=sandbox-sq0idb-replace_me      # public; also used by Web Payments SDK
SQUARE_LOCATION_ID=L_replace_me                      # default location for charges
SQUARE_WEBHOOK_SIGNATURE_KEY=replace_me              # per-subscription, from the dashboard
SQUARE_WEBHOOK_URL=https://your-app.example.com/webhooks/square
SQUARE_ENV=sandbox                                   # "sandbox" | "production"`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/square.ts
import { randomUUID } from "node:crypto";
import { SquareClient, SquareEnvironment, SquareError, WebhooksHelper } from "square";
import type { App } from "@daloyjs/core";

const square = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment:
    process.env.SQUARE_ENV === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
});

export interface SquareClientWrapper {
  raw: SquareClient;

  createPayment(input: {
    sourceId: string;                  // token from Web Payments SDK
    amountMinor: bigint;               // smallest unit \u2014 cents for USD, etc.
    currency: string;                  // ISO-4217, uppercase
    idempotencyKey?: string;           // defaults to randomUUID()
    locationId?: string;               // defaults to env LOCATION_ID
    referenceId?: string;              // your internal id (\u2264 40 chars)
    note?: string;                     // \u2264 500 chars
    autocomplete?: boolean;            // default true (capture on auth)
  }): Promise<{ id: string; status: string; orderId?: string; receiptUrl?: string }>;

  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;

  getPayment(paymentId: string): Promise<{ id: string; status: string; amountMinor: bigint; currency: string }>;

  refund(input: {
    paymentId: string;
    amountMinor: bigint;
    currency: string;
    idempotencyKey?: string;
    reason?: string;
  }): Promise<{ id: string; status: string }>;
}

export const squarePlugin = {
  name: "square",
  register(app: App) {
    const client: SquareClientWrapper = {
      raw: square,

      async createPayment({
        sourceId,
        amountMinor,
        currency,
        idempotencyKey = randomUUID(),
        locationId = process.env.SQUARE_LOCATION_ID!,
        referenceId,
        note,
        autocomplete = true,
      }) {
        const { payment } = await square.payments.create({
          sourceId,
          idempotencyKey,
          amountMoney: { amount: amountMinor, currency },
          locationId,
          referenceId,
          note,
          autocomplete,
        });
        if (!payment) throw new Error("Square returned no payment");
        return {
          id: payment.id!,
          status: payment.status!,
          orderId: payment.orderId,
          receiptUrl: payment.receiptUrl,
        };
      },

      verifyWebhookSignature(rawBody, signatureHeader) {
        if (!signatureHeader) return false;
        return WebhooksHelper.verifySignature({
          requestBody: rawBody,
          signatureHeader,
          signatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY!,
          notificationUrl: process.env.SQUARE_WEBHOOK_URL!,
        });
      },

      async getPayment(paymentId) {
        const { payment } = await square.payments.get({ paymentId });
        if (!payment) throw new Error(\`Square payment \${paymentId} not found\`);
        return {
          id: payment.id!,
          status: payment.status!,
          amountMinor: payment.amountMoney!.amount!,
          currency: payment.amountMoney!.currency!,
        };
      },

      async refund({ paymentId, amountMinor, currency, idempotencyKey = randomUUID(), reason }) {
        const { refund } = await square.refunds.refundPayment({
          paymentId,
          idempotencyKey,
          amountMoney: { amount: amountMinor, currency },
          reason,
        });
        if (!refund) throw new Error("Square returned no refund");
        return { id: refund.id!, status: refund.status! };
      },
    };

    app.decorate("square", client);
  },
};

export { SquareError };

declare module "@daloyjs/core" {
  interface AppState {
    square: SquareClientWrapper;
  }
}`}
      />

      <h2 id="5-create-a-payment">5. Create a payment</h2>
      <SequenceDiagram
        title="Token handoff and charge"
        participants={["Browser", "DaloyJS route", "Square"]}
        steps={[
          {
            from: "Browser",
            to: "Square",
            label: "Web Payments SDK tokenises the card",
            detail: "returns a single-use sourceId (cnon:...)",
            kind: "async",
          },
          {
            from: "Browser",
            to: "DaloyJS route",
            label: "POST /checkout/square",
            detail: "sourceId + amountMinor (BigInt) + currency",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "Square",
            label: "payments.create with an idempotencyKey",
            detail: "amountMoney { amount: bigint }, locationId",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "Browser",
            label: "201 captured, or 402 on SquareError decline",
            detail: "{ paymentId, status, receiptUrl }",
            kind: "response",
          },
        ]}
        caption="The browser tokenises the card into a single-use sourceId so raw PANs never reach your server. Send an idempotencyKey on payments.create and map a 402 SquareError to a card-declined response."
      />
      <p>
        The client uses Square&apos;s{" "}
        <a
          href="https://developer.squareup.com/docs/web-payments/overview"
          target="_blank"
          rel="noreferrer"
        >
          Web Payments SDK
        </a>{" "}
        with your <code>SQUARE_APPLICATION_ID</code> + <code>SQUARE_LOCATION_ID</code>,
        tokenises the card, and posts the <code>sourceId</code> to this endpoint.
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { squarePlugin, SquareError } from "./plugins/square";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 30 }));
app.register(squarePlugin);

app.route({
  method: "POST",
  path: "/checkout/square",
  operationId: "createSquarePayment",
  request: {
    body: z.object({
      sourceId: z.string().min(1),                  // from Web Payments SDK
      amountMinor: z.coerce.bigint().positive(),    // accepts string from JSON
      currency: z.string().length(3),
      orderId: z.string().min(1).max(40),           // your internal id
      note: z.string().max(500).optional(),
    }),
  },
  responses: {
    201: {
      description: "captured",
      body: z.object({
        paymentId: z.string(),
        status: z.string(),
        receiptUrl: z.string().url().optional(),
      }),
    },
    402: { description: "card declined", body: z.object({ error: z.string() }) },
  },
  handler: async ({ body, state }) => {
    try {
      const payment = await state.square.createPayment({
        sourceId: body.sourceId,
        amountMinor: body.amountMinor,
        currency: body.currency,
        referenceId: body.orderId,
        note: body.note,
      });
      return {
        status: 201,
        body: { paymentId: payment.id, status: payment.status, receiptUrl: payment.receiptUrl },
      };
    } catch (err) {
      if (err instanceof SquareError && err.statusCode === 402) {
        const detail = err.errors?.[0]?.detail ?? "card declined";
        return { status: 402, body: { error: detail } };
      }
      throw err;
    }
  },
});`}
      />
      <p className="text-sm text-muted-foreground">
        <strong>BigInt + JSON gotcha:</strong> JavaScript&apos;s default JSON serialiser
        throws on BigInt. Map money to strings at the response edge (
        <code>amountMinor.toString()</code>) or use a custom replacer. DaloyJS&apos;s Zod
        responses already coerce BigInt to string when you declare the response as{" "}
        <code>z.string()</code>; declare a <code>z.bigint()</code> only when both ends
        agree on it.
      </p>

      <h2 id="6-webhook">6. Webhook</h2>
      <SequenceDiagram
        title="Webhook verification"
        participants={["Square", "DaloyJS route"]}
        steps={[
          {
            from: "Square",
            to: "DaloyJS route",
            label: "POST /webhooks/square",
            detail: "x-square-hmacsha256-signature over raw body",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "WebhooksHelper.verifySignature",
            detail: "raw body + signatureKey + exact notificationUrl",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "Square",
            label: "401 when the signature does not match",
            detail: "{ error: 'bad signature' }",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "Square",
            label: "getPayment(id) to confirm COMPLETED, then ack",
            detail: "200, dedupe on event_id",
            kind: "async",
          },
        ]}
        caption="verifySignature needs the raw body, the signature key, and the exact registered notificationUrl. A wrong URL (trailing slash, http vs https) fails every event. Refetch the payment to confirm COMPLETED before fulfilling."
      />
      <CodeBlock
        code={`import { readRawBody } from "@daloyjs/core/raw";

app.route({
  method: "POST",
  path: "/webhooks/square",
  operationId: "squareWebhook",
  responses: {
    200: { description: "ok", body: z.object({ ok: z.literal(true) }) },
    401: { description: "bad signature", body: z.object({ error: z.string() }) },
  },
  handler: async ({ request, state }) => {
    const raw = await readRawBody(request);
    const signature = request.headers.get("x-square-hmacsha256-signature");

    if (!state.square.verifyWebhookSignature(raw, signature)) {
      return { status: 401, body: { error: "bad signature" } };
    }

    const event = JSON.parse(raw) as {
      type: string;
      event_id: string;
      data: { type: string; id: string; object?: unknown };
    };

    // Idempotency: keep a 24h record of event.event_id; Square retries non-2xx.
    switch (event.type) {
      case "payment.updated":
      case "payment.created": {
        // Re-fetch with the SDK to get the authoritative status before fulfilling.
        const fresh = await state.square.getPayment(event.data.id);
        if (fresh.status === "COMPLETED") {
          // Mark order paid \u2014 idempotent on (payment.id).
        }
        break;
      }
      case "refund.updated":
        // Reconcile refund state.
        break;
    }

    return { status: 200, body: { ok: true as const } };
  },
});`}
      />
      <p>
        Square retries non-2xx responses with backoff for up to 72 hours. Once the
        signature checks out, ack with 200 even for event types you don&apos;t handle, and
        do the slow work asynchronously.
      </p>

      <h2 id="7-refunds">7. Refunds</h2>
      <CodeBlock
        code={`// Full refund \u2014 use the original payment's amount.
await state.square.refund({
  paymentId: "pay_xxx",
  amountMinor: BigInt(1000),     // $10.00
  currency: "USD",
  reason: "Customer changed mind",
});

// Partial refund \u2014 amount strictly less than the captured amount.
await state.square.refund({
  paymentId: "pay_xxx",
  amountMinor: BigInt(250),      // $2.50 back
  currency: "USD",
});`}
      />

      <h2 id="runtimes">Runtimes</h2>
      <p>
        The v40+ SDK is Fern-generated and uses the platform <code>fetch</code> when
        available, falling back to <code>node-fetch</code>. Square officially supports
        Node.js 18+, Vercel (Edge and Node), Cloudflare Workers, Deno 1.25+, Bun 1.0+, and
        React Native, so the same plugin runs on Edge runtimes unchanged. The only thing
        to watch is reading the raw body: on Edge, use{" "}
        <code>await request.text()</code> instead of <code>readRawBody</code> if your
        adapter doesn&apos;t expose Node streams.
      </p>

      <h2 id="errors">Errors</h2>
      <p>
        Non-2xx responses throw <code>SquareError</code>. Inspect{" "}
        <code>err.statusCode</code>, <code>err.body</code>, and the structured{" "}
        <code>err.errors[]</code> array, each entry has <code>category</code> (e.g.{" "}
        <code>PAYMENT_METHOD_ERROR</code>), <code>code</code> (e.g.{" "}
        <code>CARD_DECLINED</code>, <code>CVV_FAILURE</code>), <code>detail</code>, and an
        optional <code>field</code>. Map them through{" "}
        <Link href="/docs/errors">problem+json</Link> with{" "}
        <code>type: square:&lt;category&gt;:&lt;code&gt;</code> so reconciliation tools can
        join them later.
      </p>

      <h2 id="modernisation-notes">Modernisation notes</h2>
      <ul>
        <li>
          <strong>Use the new SDK, not <code>square/legacy</code>.</strong> The legacy
          export exists so v39 codebases can migrate piecemeal, there&apos;s no reason to
          start a new integration on it in 2026. New features ship to the new client first
          (or only).
        </li>
        <li>
          <strong>Pin a Square API version in production.</strong> The SDK is tied to a
          Square API version per release, and a new SDK major (v40 → v41 → ...) can be a
          breaking change. Pin <code>square</code> to a caret range you control and read
          the changelog before bumping.
        </li>
        <li>
          <strong>Iterate paginated endpoints with <code>for await</code>.</strong> List
          responses are async-iterable: <code>for (const item of pageable)</code>{" "}
          (synchronously) only gives you the first page; use{" "}
          <code>for await (const item of pageable)</code> to walk all pages without manual
          cursor juggling.
        </li>
        <li>
          <strong>Verify webhooks; don&apos;t trust the source IP.</strong> Square&apos;s
          IP ranges change. The HMAC + the registered notification URL together prove
          authenticity and that the request hit the right endpoint.
        </li>
      </ul>

      <p>
        See also the <Link href={"/docs/payments" as Route}>payments overview</Link>,{" "}
        <Link href={"/docs/payments/braintree" as Route}>Braintree guide</Link>,{" "}
        <Link href={"/docs/payments/authorize-net" as Route}>Authorize.Net guide</Link>,
        and <Link href="/docs/errors">problem+json errors</Link>.
      </p>
    </>
  );
}
