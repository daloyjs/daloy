import Link from "next/link";
import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Accept payments with PayTabs in DaloyJS",
  description:
    "Integrate PayTabs (cards, Mada, KNET, BenefitPay, STC Pay, Apple Pay) from a DaloyJS API using the official paytabs_pt2 Node package. Covers setConfig, createPaymentPage wrapped as a Promise, the redirect + IPN flow, HMAC-SHA256 signature verification, and transaction queries.",
  path: "/docs/payments/paytabs",
  keywords: [
    "DaloyJS PayTabs",
    "paytabs_pt2",
    "PayTabs Node",
    "createPaymentPage",
    "PayTabs IPN signature",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Accept payments with PayTabs in DaloyJS</h1>
      <p>
        <a href="https://paytabs.com/" target="_blank" rel="noreferrer">
          PayTabs
        </a>{" "}
        is a MENA-region payment gateway with strong coverage of{" "}
        <strong>Mada</strong>, <strong>KNET</strong>, <strong>BenefitPay</strong>,{" "}
        <strong>STC Pay</strong>, <strong>OmanNet</strong>, cards, and Apple Pay. This guide
        uses the official{" "}
        <a
          href="https://docs.paytabs.com/manuals/Backend-Web-Packages/NodeJs/"
          target="_blank"
          rel="noreferrer"
        >
          <code>paytabs_pt2</code>
        </a>{" "}
        npm package from a DaloyJS server, wrapped to feel like a normal async API.
      </p>

      <h2>What you should know up front</h2>
      <ul>
        <li>
          <strong>The official SDK is callback-based with positional array arguments.</strong>{" "}
          It works, but it&apos;s noisy. We&apos;ll wrap{" "}
          <code>createPaymentPage</code> once in a Promise-returning function with named
          object arguments, every route handler stays clean after that.
        </li>
        <li>
          <strong>Regions are not interchangeable.</strong> Your profile lives in one of{" "}
          <code>ARE</code>, <code>SAU</code>, <code>OMN</code>, <code>JOR</code>,{" "}
          <code>EGY</code>, <code>IRQ</code>, <code>PSE</code>, or <code>GLOBAL</code>.
          Passing the wrong region results in <em>&quot;Invalid credentials&quot;</em>{" "}
          even when the key is right.
        </li>
        <li>
          <strong>It&apos;s a redirect flow.</strong> You call{" "}
          <code>createPaymentPage</code>, PayTabs returns a <code>redirect_url</code>, the
          customer pays there and comes back to your <em>return</em> URL. The{" "}
          <em>callback</em> URL is the server-side IPN, that&apos;s the only signal you
          should mark an order paid on.
        </li>
        <li>
          <strong>IPN signature is HMAC-SHA256.</strong> The raw POST body is signed with
          your <code>server_key</code> and sent in the <code>signature</code> header. Verify
          before trusting anything in the payload.
        </li>
        <li>
          <strong>Use <code>tran_type: &quot;sale&quot;</code></strong> for direct
          capture, <code>&quot;auth&quot;</code> for an authorisation you&apos;ll capture
          later, and <code>tran_class: &quot;ecom&quot;</code> for normal online checkouts.
        </li>
      </ul>

      <h2>1. Provision</h2>
      <ol>
        <li>
          Sign in to the{" "}
          <a href="https://merchant.paytabs.com/" target="_blank" rel="noreferrer">
            PayTabs merchant dashboard
          </a>
          .
        </li>
        <li>
          Developers → Profile to grab your <strong>Profile ID</strong> and{" "}
          <strong>Server Key</strong>. Note your <strong>Region</strong>.
        </li>
        <li>
          Enable the payment methods you need (Mada, KNET, BenefitPay, STC Pay all require
          explicit activation, some need extra paperwork).
        </li>
        <li>
          In Developers → IPN, point the IPN URL at your DaloyJS webhook endpoint.
        </li>
      </ol>

      <h2>2. Install</h2>
      <CodeBlock code={`pnpm add paytabs_pt2`} />

      <h2>3. Environment variables</h2>
      <CodeBlock
        code={`# .env
PAYTABS_PROFILE_ID=12345
PAYTABS_SERVER_KEY=SXXXXXXXXX-JXXXXXXXXX-LXXXXXXXXX
PAYTABS_REGION=ARE                  # ARE | SAU | OMN | JOR | EGY | IRQ | PSE | GLOBAL
APP_URL=https://your-app.example.com`}
      />

      <h2>4. Plugin</h2>
      <p>
        We wrap two things here: <code>createPaymentPage</code>&apos;s
        positional-array+callback shape into a Promise with named args, and the IPN
        signature check into a one-call helper. <code>setConfig</code> is module-global, so
        we only call it once at register time.
      </p>
      <CodeBlock
        code={`// src/plugins/paytabs.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import PayTabs from "paytabs_pt2";
import type { App } from "@daloyjs/core";

PayTabs.setConfig(
  process.env.PAYTABS_PROFILE_ID!,
  process.env.PAYTABS_SERVER_KEY!,
  process.env.PAYTABS_REGION!,
);

interface PayTabsResponse {
  tran_ref?: string;
  redirect_url?: string;
  payment_result?: { response_status: string; response_code: string; response_message: string };
  cart_id?: string;
  cart_amount?: string;
  cart_currency?: string;
  signature?: string;
  [k: string]: unknown;
}

export interface PayTabsClient {
  createPaymentPage(input: {
    cart: { id: string; amount: number; currency: string; description: string };
    customer: {
      name: string;
      email: string;
      phone: string;        // include country code, e.g. "971500000000"
      street: string;
      city: string;
      state: string;
      country: string;      // ISO-3166-1 alpha-2, e.g. "AE"
      zip: string;
      ip: string;
    };
    shipping?: PayTabsClient extends never ? never : Parameters<PayTabsClient["createPaymentPage"]>[0]["customer"];
    paymentMethods?: string[];          // ["all"], ["creditcard", "mada"], ["knet"], ...
    type?: "sale" | "auth";
    class?: "ecom" | "recurring" | "moto";
    lang?: "ar" | "en";
    frame?: boolean;
  }): Promise<PayTabsResponse>;

  queryTransaction(tranRef: string): Promise<PayTabsResponse>;

  refund(input: {
    tranRef: string;
    amount: number;
    currency: string;
    cartId: string;
    description: string;
  }): Promise<PayTabsResponse>;

  verifyIpnSignature(rawBody: string, signatureHeader: string | null): boolean;
}

function pageArgs(input: Parameters<PayTabsClient["createPaymentPage"]>[0]) {
  const c = input.customer;
  const customer = [c.name, c.email, c.phone, c.street, c.city, c.state, c.country, c.zip, c.ip];
  const s = input.shipping ?? c;
  const shipping = [s.name, s.email, s.phone, s.street, s.city, s.state, s.country, s.zip, s.ip];
  return {
    methods: input.paymentMethods ?? ["all"],
    transaction: [input.type ?? "sale", input.class ?? "ecom"],
    cart: [input.cart.id, input.cart.currency, input.cart.amount, input.cart.description],
    customer,
    shipping,
    urls: [
      \`\${process.env.APP_URL}/checkout/paytabs/return?order=\${encodeURIComponent(input.cart.id)}\`,
      \`\${process.env.APP_URL}/webhooks/paytabs\`,
    ],
    lang: input.lang ?? "en",
    frame: input.frame ?? false,
  };
}

export const paytabsPlugin = {
  name: "paytabs",
  register(app: App) {
    const client: PayTabsClient = {
      createPaymentPage(input) {
        const a = pageArgs(input);
        return new Promise((resolve, reject) => {
          PayTabs.createPaymentPage(
            a.methods,
            a.transaction,
            a.cart,
            a.customer,
            a.shipping,
            a.urls,
            a.lang,
            (response: PayTabsResponse) => {
              if (response?.redirect_url) resolve(response);
              else reject(Object.assign(new Error("paytabs createPaymentPage failed"), { response }));
            },
            a.frame,
          );
        });
      },

      queryTransaction(tranRef) {
        return new Promise((resolve, reject) => {
          PayTabs.queryTransaction(tranRef, (response: PayTabsResponse) => {
            if (response) resolve(response);
            else reject(new Error("paytabs queryTransaction failed"));
          });
        });
      },

      refund({ tranRef, amount, currency, cartId, description }) {
        return new Promise((resolve, reject) => {
          PayTabs.refund(
            tranRef,
            [amount, currency, cartId, description],
            (response: PayTabsResponse) => {
              if (response) resolve(response);
              else reject(new Error("paytabs refund failed"));
            },
          );
        });
      },

      verifyIpnSignature(rawBody, signatureHeader) {
        if (!signatureHeader) return false;
        const expected = createHmac("sha256", process.env.PAYTABS_SERVER_KEY!)
          .update(rawBody)
          .digest("hex");
        const a = Buffer.from(signatureHeader);
        const b = Buffer.from(expected);
        return a.length === b.length && timingSafeEqual(a, b);
      },
    };

    app.decorate("paytabs", client);
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    paytabs: PayTabsClient;
  }
}`}
      />
      <p>
        The signature check uses the <em>raw</em> request body, if you JSON.parse and
        re-stringify, the byte order changes and the HMAC won&apos;t match.
      </p>

      <h2>5. Create a payment page</h2>
      <SequenceDiagram
        title="Payment page flow"
        participants={["Customer", "DaloyJS route", "PayTabs"]}
        steps={[
          {
            from: "Customer",
            to: "DaloyJS route",
            label: "POST /checkout/paytabs",
            detail: "cart + customer (region-bound profile)",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "PayTabs",
            label: "createPaymentPage with return + callback URLs",
            detail: "tran_type 'sale', tran_class 'ecom'",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "Customer",
            label: "Return redirect_url",
            detail: "201 { tranRef, redirectUrl }",
            kind: "response",
          },
          {
            from: "Customer",
            to: "PayTabs",
            label: "Pays on the hosted page, returns via the return URL",
            detail: "return URL is a UX hint, not proof",
            kind: "async",
          },
        ]}
        caption="Create the payment page, redirect the customer to redirect_url, and render a confirmation on the return URL only. The server-side IPN is the only signal you should mark an order paid on."
      />
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { paytabsPlugin } from "./plugins/paytabs";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 30 }));
app.register(paytabsPlugin);

app.route({
  method: "POST",
  path: "/checkout/paytabs",
  operationId: "createPayTabsPaymentPage",
  request: {
    body: z.object({
      orderId: z.string().min(1).max(80),
      amount: z.number().positive(),
      currency: z.enum(["AED", "SAR", "KWD", "BHD", "OMR", "QAR", "EGP", "JOD", "USD"]),
      description: z.string().min(1).max(255),
      paymentMethods: z.array(z.string()).optional(),
      customer: z.object({
        name: z.string().min(1).max(80),
        email: z.string().email(),
        phone: z.string().min(7).max(20),
        street: z.string().max(120),
        city: z.string().max(60),
        state: z.string().max(60),
        country: z.string().length(2),
        zip: z.string().max(20),
      }),
    }),
  },
  responses: {
    201: {
      description: "redirect to PayTabs",
      body: z.object({ tranRef: z.string(), redirectUrl: z.string().url() }),
    },
  },
  handler: async ({ body, request, state }) => {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "0.0.0.0";

    const response = await state.paytabs.createPaymentPage({
      cart: {
        id: body.orderId,
        amount: body.amount,
        currency: body.currency,
        description: body.description,
      },
      customer: { ...body.customer, ip },
      paymentMethods: body.paymentMethods,
    });

    return {
      status: 201,
      body: { tranRef: response.tran_ref!, redirectUrl: response.redirect_url! },
    };
  },
});`}
      />

      <h2>6. IPN webhook</h2>
      <SequenceDiagram
        title="IPN verification"
        participants={["PayTabs", "DaloyJS route"]}
        steps={[
          {
            from: "PayTabs",
            to: "DaloyJS route",
            label: "POST /webhooks/paytabs",
            detail: "signature header (HMAC-SHA256) over raw body",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "HMAC-SHA256 the raw body with the server_key",
            detail: "timingSafeEqual vs the signature header",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "PayTabs",
            label: "401 when the signature does not match",
            detail: "{ error: 'bad signature' }",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "PayTabs",
            label: "queryTransaction(tran_ref), fulfil on status 'A', ack",
            detail: "200, re-query before fulfilment",
            kind: "async",
          },
        ]}
        caption="Verify the HMAC-SHA256 signature over the raw body with your server_key, reject mismatches with 401, then re-query the transaction and fulfil only when response_status is 'A'."
      />
      <p>
        PayTabs POSTs the same payload as a successful{" "}
        <code>queryTransaction</code> call to your IPN URL on every transaction state
        change. Always verify the signature, ack 200 fast, and re-query before fulfilment if
        you don&apos;t fully trust the body:
      </p>
      <CodeBlock
        code={`import { readRawBody } from "@daloyjs/core/raw";

app.route({
  method: "POST",
  path: "/webhooks/paytabs",
  operationId: "paytabsIpn",
  responses: {
    200: { description: "ok", body: z.object({ ok: z.literal(true) }) },
    401: { description: "bad signature", body: z.object({ error: z.string() }) },
  },
  handler: async ({ request, state }) => {
    const raw = await readRawBody(request);
    const signature = request.headers.get("signature");

    if (!state.paytabs.verifyIpnSignature(raw, signature)) {
      return { status: 401, body: { error: "bad signature" } };
    }

    const event = JSON.parse(raw) as Awaited<ReturnType<typeof state.paytabs.queryTransaction>>;
    const orderId = event.cart_id;
    const status = event.payment_result?.response_status; // "A" authorized, "H" hold, "P" pending, "V" voided, "E" error, "D" declined

    if (status === "A" && orderId) {
      // Optional safety net: re-fetch before fulfilment.
      const fresh = await state.paytabs.queryTransaction(event.tran_ref!);
      if (fresh.payment_result?.response_status === "A") {
        // Fulfil the order. Idempotency key = (orderId, tran_ref).
      }
    }

    return { status: 200, body: { ok: true as const } };
  },
});`}
      />

      <h2>7. Refunds and capture</h2>
      <CodeBlock
        code={`// Full or partial refund of a captured sale.
await state.paytabs.refund({
  tranRef: "TST2026000000001",
  amount: 100,
  currency: "AED",
  cartId: "order_123",
  description: "Customer request",
});

// Capture a previously authorized transaction (tran_type "auth").
// The SDK exposes PayTabs.capture(tranRef, [amount, currency, cartId, description], cb)
// \u2014 wrap it the same way as refund() in the plugin if you need it.`}
      />

      <h2>Runtimes</h2>
      <p>
        <code>paytabs_pt2</code> uses Node&apos;s <code>https</code> module and runs on Node
        18+. It is <em>not</em> edge-runtime compatible. If you&apos;re deploying to
        Cloudflare Workers or Vercel Edge, call the PayTabs PT2 REST endpoints directly with{" "}
        <code>fetch</code> (Bearer auth on <code>Authorization</code> using the server key,
        endpoints like <code>POST /payment/request</code> and{" "}
        <code>POST /payment/query</code> against your regional base URL).
      </p>

      <h2>Errors</h2>
      <p>
        On failure, <code>response.payment_result.response_code</code> tells you the gateway
        outcome (e.g. <code>200</code> success, <code>481</code> 3-D Secure failed,{" "}
        <code>500</code> generic decline). Surface declines through{" "}
        <Link href="/docs/errors">problem+json</Link> with the PayTabs{" "}
        <code>response_message</code> in the <code>detail</code> field, don&apos;t pass it
        verbatim to end users; declines often include scheme-specific text the customer
        can&apos;t act on.
      </p>

      <h2>Modernisation notes</h2>
      <ul>
        <li>
          <strong>Wrap the SDK once, then forget it.</strong> The positional-array
          signatures are easy to typo and harder to grep for than named-object arguments.
          The plugin above pays that cost in one place.
        </li>
        <li>
          <strong>Verify the IPN signature, always.</strong> Don&apos;t fall back to
          &quot;the IP is from PayTabs&quot;, IPs change, and HMAC over the raw body is
          the only verification PayTabs actually publishes a contract for.
        </li>
        <li>
          <strong>Fulfil on IPN, not on return URL.</strong> The customer can close the tab
          mid-3DS. The IPN is the source of truth; the return URL just renders a
          confirmation page.
        </li>
        <li>
          <strong>Consider the REST API directly if you need edge.</strong> The Node SDK
          predates the wide adoption of edge runtimes. A 30-line <code>fetch</code> wrapper
          gives you the same shape and works on Workers/Edge, at the cost of maintaining
          the request shape yourself.
        </li>
      </ul>

      <p>
        See also the <Link href={"/docs/payments" as Route}>payments overview</Link>,{" "}
        <Link href={"/docs/payments/tap" as Route}>Tap Payments guide</Link>,{" "}
        <Link href={"/docs/payments/adyen" as Route}>Adyen guide</Link>, and{" "}
        <Link href="/docs/errors">problem+json errors</Link>.
      </p>
    </>
  );
}
