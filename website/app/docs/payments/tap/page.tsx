import Link from "next/link";
import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Accept payments with Tap Payments in DaloyJS",
  description:
    "Integrate Tap Payments (KNET, Mada, Benefit, KFAST, STC Pay, BenefitPay, cards, and Apple Pay) from a DaloyJS API. Covers Bearer-token auth against api.tap.company/v2, the hosted Charge redirect flow, hashstring webhook verification, and idempotency.",
  path: "/docs/payments/tap",
  keywords: [
    "DaloyJS Tap Payments",
    "Tap Payments Node",
    "Tap Charges API",
    "tap hashstring webhook",
    "KNET Mada Benefit STC Pay",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Accept payments with Tap Payments in DaloyJS</h1>
      <p>
        <a href="https://www.tap.company/" target="_blank" rel="noreferrer">
          Tap Payments
        </a>{" "}
        is the default acquirer for the GCC and wider MENA region, it&apos;s how
        you accept <strong>KNET</strong> (Kuwait), <strong>Mada</strong>{" "}
        (Saudi), <strong>Benefit / BenefitPay</strong> (Bahrain),{" "}
        <strong>STC Pay</strong>
        {", "}plus cards, Apple Pay, Google Pay, and BNPL methods like Tabby and
        Tamara. There&apos;s no first-party Node SDK; you integrate against the{" "}
        <a
          href="https://developers.tap.company/reference/api-endpoint"
          target="_blank"
          rel="noreferrer"
        >
          REST API
        </a>{" "}
        with <code>fetch</code>.
      </p>

      <h2 id="what-you-should-know-up-front">What you should know up front</h2>
      <ul>
        <li>
          Bearer auth, secret key in the backend only.{" "}
          <code>Authorization: Bearer sk_test_...</code> or{" "}
          <code>sk_live_...</code>
          {". "}Public keys (<code>pk_*</code>) are for the frontend SDKs; never
          send a secret key from the browser.
        </li>
        <li>
          It&apos;s a redirect flow. You create a charge, Tap returns{" "}
          <code>transaction.url</code>
          {", "}you redirect the customer. They come back via your{" "}
          <code>redirect.url</code> with <code>?tap_id=chg_xxx</code>
          {": "}that&apos;s a UX hint, not proof of payment.
        </li>
        <li>
          Webhooks come with a <code>hashstring</code>. Tap sends an HMAC-SHA256
          over a specific concatenation of fields, base64-encoded, in the{" "}
          <code>hashstring</code> header. Verify it on every request; never
          trust the body alone.
        </li>
        <li>
          Amounts are decimals. Tap takes{" "}
          <code>{`{ amount: 10, currency: "KWD" }`}</code> as a number, but KWD
          has 3 decimals (fils), SAR/AED/QAR/BHD have 2/3, USD 2. Use the right
          precision per currency or you&apos;ll under/overcharge.
        </li>
        <li>
          Always re-fetch the charge. On both webhook and redirect return, GET{" "}
          <code>/v2/charges/{`{id}`}</code> before marking anything paid. The
          status you want is <code>CAPTURED</code> (or <code>AUTHORIZED</code>{" "}
          for the auth-only flow).
        </li>
      </ul>

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Create an account at{" "}
          <a href="https://tap.company/" target="_blank" rel="noreferrer">
            tap.company
          </a>{" "}
          and sign in to the{" "}
          <a href="https://os.tap.company/" target="_blank" rel="noreferrer">
            dashboard
          </a>
          {"."}
        </li>
        <li>
          Accounts -&gt; Operators -&gt; MERCHANT to grab your{" "}
          <strong>Merchant ID</strong>
          {", "}plus <strong>Test/Live Secret Keys</strong> (<code>sk_*</code>)
          and <strong>Public Keys</strong> (<code>pk_*</code>).
        </li>
        <li>
          Enable the payment methods you need (KNET, Mada, Benefit, etc.), some
          require contacting Tap support for activation.
        </li>
        <li>
          Configure a webhook URL on your account so Tap can POST events to your
          DaloyJS server.
        </li>
      </ol>

      <h2 id="2-environment-variables">2. Environment variables</h2>
      <CodeBlock
        code={`# .env
TAP_SECRET_KEY=sk_test_replace_me        # sk_live_... in production
TAP_PUBLIC_KEY=pk_test_replace_me        # ships to the browser SDKs
TAP_MERCHANT_ID=merchant_xxx
APP_URL=https://your-app.example.com`}
      />

      <h2 id="3-plugin-no-sdk-fetch-based">3. Plugin (no SDK: fetch-based)</h2>
      <CodeBlock
        code={`// src/plugins/tap.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { App } from "@daloyjs/core";

const BASE = "https://api.tap.company/v2";

type Money = { amount: number; currency: string };

type ChargeStatus =
  | "INITIATED" | "ABANDONED" | "CANCELLED" | "FAILED" | "DECLINED"
  | "RESTRICTED" | "CAPTURED" | "AUTHORIZED" | "VOID" | "TIMEDOUT" | "UNKNOWN";

interface TapCharge {
  id: string;
  status: ChargeStatus;
  amount: number;
  currency: string;
  reference?: { order?: string; transaction?: string };
  transaction?: { url?: string };
  customer?: { id?: string; first_name?: string; email?: string };
  source?: { id: string };
  metadata?: Record<string, string>;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(\`\${BASE}\${path}\`, {
    ...init,
    headers: {
      Authorization: \`Bearer \${process.env.TAP_SECRET_KEY}\`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(\`tap \${res.status}: \${body?.errors?.[0]?.description ?? res.statusText}\`);
    Object.assign(err, { status: res.status, body });
    throw err;
  }
  return body as T;
}

// Field order matters \u2014 keep this aligned with the docs page:
// https://developers.tap.company/docs/webhook#validate-the-webhook-hashstring
function buildHashString(c: TapCharge): string {
  return [
    \`x_id\${c.id}\`,
    \`x_amount\${c.amount.toFixed(3)}\`,           // 3 decimals; trim later if needed for your currency
    \`x_currency\${c.currency}\`,
    \`x_gateway_reference\${c.reference?.transaction ?? ""}\`,
    \`x_payment_reference\${c.reference?.order ?? ""}\`,
    \`x_status\${c.status}\`,
    \`x_created\${(c as unknown as { transaction?: { created?: string } }).transaction?.created ?? ""}\`,
  ].join("");
}

export interface TapClient {
  createCharge(input: {
    amount: number;
    currency: string;                                 // "KWD" | "SAR" | "AED" | ...
    description: string;
    orderId: string;
    customer: { first_name: string; email?: string; phone?: { country_code: string; number: string } };
    source: { id: string };                           // "src_all" (hosted), "src_kw.knet", "src_sa.mada", "src_card", ...
    metadata?: Record<string, string>;
  }): Promise<TapCharge>;

  getCharge(id: string): Promise<TapCharge>;

  refund(input: {
    chargeId: string;
    amount: number;
    currency: string;
    reason: string;
    orderId: string;
  }): Promise<{ id: string; status: string }>;

  verifyWebhookHash(body: TapCharge, signatureHeader: string | null): boolean;
}

export const tapPlugin = {
  name: "tap",
  register(app: App) {
    const client: TapClient = {
      createCharge({ amount, currency, description, orderId, customer, source, metadata }) {
        return call<TapCharge>("/charges", {
          method: "POST",
          body: JSON.stringify({
            amount,
            currency,
            description,
            statement_descriptor: description.slice(0, 22),
            reference: { transaction: orderId, order: orderId },
            receipt: { email: !!customer.email, sms: !!customer.phone },
            customer,
            source,
            post: { url: \`\${process.env.APP_URL}/webhooks/tap\` },
            redirect: { url: \`\${process.env.APP_URL}/checkout/tap/return?order=\${encodeURIComponent(orderId)}\` },
            metadata,
          }),
        });
      },

      getCharge(id) {
        return call<TapCharge>(\`/charges/\${id}\`);
      },

      refund({ chargeId, amount, currency, reason, orderId }) {
        return call("/refunds", {
          method: "POST",
          body: JSON.stringify({
            charge_id: chargeId,
            amount,
            currency,
            reason,
            reference: { merchant: orderId },
            post: { url: \`\${process.env.APP_URL}/webhooks/tap\` },
          }),
        });
      },

      verifyWebhookHash(body, signatureHeader) {
        if (!signatureHeader) return false;
        const expected = createHmac("sha256", process.env.TAP_SECRET_KEY!)
          .update(buildHashString(body))
          .digest("hex");
        const a = Buffer.from(signatureHeader);
        const b = Buffer.from(expected);
        return a.length === b.length && timingSafeEqual(a, b);
      },
    };
    app.decorate("tap", client);
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    tap: TapClient;
  }
}`}
      />
      <p>
        The field order inside <code>buildHashString</code> is the part Tap is
        strict about , keep it pinned to{" "}
        <a
          href="https://developers.tap.company/docs/webhook"
          target="_blank"
          rel="noreferrer"
        >
          their webhook docs
        </a>
        {". "}If they add a new field to the hash, every webhook will fail until
        you update the function.
      </p>

      <h2 id="4-create-a-hosted-charge">4. Create a hosted charge</h2>
      <SequenceDiagram
        title="Hosted charge flow"
        participants={["Customer", "DaloyJS route", "Tap"]}
        steps={[
          {
            from: "Customer",
            to: "DaloyJS route",
            label: "POST /checkout/tap",
            detail: "orderId + amount + source { id: 'src_all' }",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "Tap",
            label: "POST /v2/charges with post + redirect URLs",
            detail: "Authorization: Bearer sk_...",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "Customer",
            label: "Return transaction.url",
            detail: "201 { redirectUrl }",
            kind: "response",
          },
          {
            from: "Customer",
            to: "Tap",
            label: "Pays on the hosted page, returns with ?tap_id=chg_xxx",
            detail: "redirect is a UX hint, not proof",
            kind: "async",
          },
        ]}
        caption="Create the charge with src_all for the hosted page, redirect the customer to transaction.url, and treat the ?tap_id on return as a hint only. The webhook plus a refetch is what marks an order paid."
      />
      <p>
        The simplest integration: <code>source.id: &quot;src_all&quot;</code>{" "}
        gets you Tap&apos;s hosted checkout page with every method you&apos;ve
        enabled. Use <code>src_card</code>
        {", "}
        <code>src_kw.knet</code>
        {", "}
        <code>src_sa.mada</code>
        {", "}etc. to pin a specific method.
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { tapPlugin } from "./plugins/tap.ts";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 30 }));
app.register(tapPlugin);

app.post(
  "/checkout/tap",
  {
    operationId: "createTapCharge",
    request: {
      body: z.object({
        orderId: z.string().min(1).max(80),
        amount: z.number().positive(),
        currency: z.enum(["KWD", "SAR", "AED", "BHD", "QAR", "OMR", "EGP", "USD"]),
        description: z.string().min(1).max(200),
        source: z.string().default("src_all"),
        customer: z.object({
          first_name: z.string().min(1).max(80),
          email: z.email().optional(),
        }),
      }),
    },
    responses: {
      201: {
        description: "redirect to Tap",
        body: z.object({ chargeId: z.string(), redirectUrl: z.url() }),
      },
    },
  },
  async ({ body, state }) => {
    const charge = await state.tap.createCharge({
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      orderId: body.orderId,
      customer: body.customer,
      source: { id: body.source },
      metadata: { orderId: body.orderId },
    });
    const url = charge.transaction?.url;
    if (!url) throw new Error("Tap did not return a redirect URL");
    return { status: 201, body: { chargeId: charge.id, redirectUrl: url } };
  },
);`}
      />

      <h2 id="5-webhook">5. Webhook</h2>
      <SequenceDiagram
        title="Webhook verification"
        participants={["Tap", "DaloyJS route"]}
        steps={[
          {
            from: "Tap",
            to: "DaloyJS route",
            label: "POST /webhooks/tap",
            detail: "hashstring header over ordered fields",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "Rebuild buildHashString, HMAC-SHA256 with the secret key",
            detail: "timingSafeEqual vs the hashstring header",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "Tap",
            label: "401 when the hash does not match",
            detail: "{ error: 'bad hashstring' }",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "Tap",
            label: "GET /v2/charges/{id} to confirm CAPTURED, then ack",
            detail: "200, fulfil on the refetched status",
            kind: "async",
          },
        ]}
        caption="Recompute the hashstring with the same field order Tap documents, reject mismatches with 401, then refetch the charge so a replayed or out-of-order delivery cannot flip a paid order back to pending."
      />
      <p>
        Tap POSTs JSON for every charge state change. Verify the{" "}
        <code>hashstring</code> header, then refetch the charge before doing
        anything irreversible:
      </p>
      <CodeBlock
        code={`app.post(
  "/webhooks/tap",
  {
    operationId: "tapWebhook",
    responses: {
      200: { description: "ok", body: z.object({ ok: z.literal(true) }) },
      401: { description: "bad hash", body: z.object({ error: z.string() }) },
    },
  },
  async ({ request, state }) => {
    const event = (await request.json()) as Awaited<ReturnType<typeof state.tap.getCharge>>;
    const signature = request.headers.get("hashstring");

    if (!state.tap.verifyWebhookHash(event, signature)) {
      return { status: 401, body: { error: "bad hashstring" } };
    }

    // Refetch to defeat replay / stale-payload tricks.
    const charge = await state.tap.getCharge(event.id);
    const orderId = charge.metadata?.orderId ?? charge.reference?.order;

    if (charge.status === "CAPTURED" && orderId) {
      // Fulfil the order. Use idempotency on your side keyed by (orderId, charge.id).
    }

    return { status: 200, body: { ok: true as const } };
  },
);`}
      />

      <h2 id="6-refunds">6. Refunds</h2>
      <CodeBlock
        code={`await state.tap.refund({
  chargeId: "chg_xxx",
  amount: 10,
  currency: "KWD",
  reason: "requested_by_customer",
  orderId: "order_123",
});`}
      />

      <h2 id="authorize-capture">Authorize + capture</h2>
      <p>
        For an auth-then-capture flow (useful for hotels, marketplaces, anything
        where the final amount is decided after the customer&apos;s session),
        use <code>/v2/authorize</code> instead of <code>/v2/charges</code>
        {", "}then <code>POST /v2/authorize/{`{id}`}</code> with{" "}
        <code>{`{ status: "VOID" }`}</code> or a capture body. Not every method
        supports it , confirm with Tap support per scheme before relying on it.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        Everything here is plain <code>fetch</code> and <code>node:crypto</code>
        {". "}Swap <code>createHmac</code> for <code>crypto.subtle</code> if
        you&apos;re targeting Cloudflare Workers, Tap itself has no runtime
        requirements beyond a TLS-capable HTTP client.
      </p>

      <h2 id="errors">Errors</h2>
      <p>
        Tap returns JSON like{" "}
        <code>{`{ "errors": [{ "code": "1101", "description": "..." }] }`}</code>{" "}
        with an HTTP error status. Map them through{" "}
        <Link href="/docs/errors">problem+json</Link>; the most common ones are
        400 (bad body), 401 (wrong key or test/live mismatch), and 404 (asking
        for a charge that belongs to a different account).
      </p>

      <h2 id="modernisation-notes">Modernisation notes</h2>
      <ul>
        <li>
          Use <code>src_all</code> for the hosted page unless you need to pin a
          method. Saves you from maintaining a method-picker UI and lets Tap
          roll out new payment options without you redeploying.
        </li>
        <li>
          Always re-fetch on webhook. The body is signed but webhooks get
          retried; treating GET <code>/charges/{`{id}`}</code> as the source of
          truth means out-of-order delivery can&apos;t flip a paid order back to
          pending.
        </li>
        <li>
          Stop using <code>charge_id</code> from the redirect to fulfil orders.{" "}
          The <code>?tap_id=</code> on the return URL is for showing the
          customer &quot;thanks&quot;, never for marking the order paid.
          Fulfillment belongs in the webhook handler.
        </li>
        <li>
          Keep <code>buildHashString</code> in one place. If Tap changes the
          hash inputs you want to update one function, not eight call sites.
        </li>
      </ul>

      <p>
        See also the{" "}
        <Link href={"/docs/payments" as Route}>payments overview</Link>
        {", "}
        <Link href={"/docs/payments/adyen" as Route}>Adyen guide</Link>
        {", "}
        <Link href={"/docs/payments/mollie" as Route}>Mollie guide</Link>
        {", "}and <Link href="/docs/errors">problem+json errors</Link>.
      </p>
    </>
  );
}
